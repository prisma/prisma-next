import { assertReviewActionsV1 } from './review-artifacts.mjs';

const DONE_REACTION_CONTENT = 'THUMBS_UP';

function buildDoneMarker(actionId) {
  return `<!-- review-framework:actionId=${actionId} kind=done -->`;
}

function buildDoneReplyBody(actionId) {
  return `Done\n\n${buildDoneMarker(actionId)}`;
}

function hasDonePrefix(body) {
  return typeof body === 'string' && /^Done(?:$|\s)/.test(body);
}

function hasDoneMarkerForAction(body, actionId) {
  return typeof body === 'string' && body.includes(buildDoneMarker(actionId));
}

function hasExactDoneBody(body, actionId) {
  return typeof body === 'string' && body.trim() === buildDoneReplyBody(actionId);
}

function hasViewerThumbsUp(reactionGroups) {
  if (!Array.isArray(reactionGroups)) {
    return false;
  }
  return reactionGroups.some(
    (group) => group?.content === DONE_REACTION_CONTENT && group?.viewerHasReacted === true,
  );
}

function normalizeComments(comments) {
  if (!Array.isArray(comments)) {
    return [];
  }
  return comments.map((comment) => ({
    nodeId: typeof comment?.nodeId === 'string' ? comment.nodeId : null,
    authorLogin: typeof comment?.authorLogin === 'string' ? comment.authorLogin : null,
    body: typeof comment?.body === 'string' ? comment.body : '',
    reactionGroups: Array.isArray(comment?.reactionGroups) ? comment.reactionGroups : [],
  }));
}

function buildStateIndex(githubState) {
  const threadIndex = new Map();
  const standaloneIndex = new Map();

  const threads = Array.isArray(githubState?.reviewThreads) ? githubState.reviewThreads : [];
  for (const thread of threads) {
    if (typeof thread?.nodeId !== 'string') {
      continue;
    }
    threadIndex.set(thread.nodeId, {
      nodeId: thread.nodeId,
      isResolved: thread.isResolved === true,
      comments: normalizeComments(thread.comments),
    });
  }

  const standaloneTargets = Array.isArray(githubState?.standaloneTargets)
    ? githubState.standaloneTargets
    : [];
  for (const target of standaloneTargets) {
    if (typeof target?.nodeId !== 'string') {
      continue;
    }
    standaloneIndex.set(target.nodeId, {
      nodeId: target.nodeId,
      replies: normalizeComments(target.replies),
      reactionGroups: Array.isArray(target?.reactionGroups) ? target.reactionGroups : [],
    });
  }

  return { threadIndex, standaloneIndex };
}

function hasDoneReplyFromViewer(comments, viewerLogin, actionId) {
  return comments.some((comment) => {
    if (comment.authorLogin !== viewerLogin) {
      return false;
    }
    if (hasDoneMarkerForAction(comment.body, actionId)) {
      return true;
    }
    if (hasExactDoneBody(comment.body, actionId)) {
      return true;
    }
    return hasDonePrefix(comment.body);
  });
}

function getThreadReactionSubject(thread) {
  if (!Array.isArray(thread.comments) || thread.comments.length === 0) {
    return null;
  }
  return thread.comments[thread.comments.length - 1] ?? null;
}

function createNoop(action, reason) {
  return {
    actionId: action.actionId,
    targetNodeId: action.target.nodeId,
    kind: 'noop',
    reason,
  };
}

function planThreadOperations(action, viewerLogin, thread) {
  const operations = [];
  const doneBody = buildDoneReplyBody(action.actionId);
  const hasDoneReply = hasDoneReplyFromViewer(thread.comments, viewerLogin, action.actionId);

  if (!hasDoneReply) {
    operations.push({
      actionId: action.actionId,
      targetNodeId: action.target.nodeId,
      kind: 'reply',
      body: doneBody,
      mutationTargetKind: 'review_thread',
    });
  } else {
    operations.push(createNoop(action, 'done_reply_exists'));
  }

  const reactionSubject = getThreadReactionSubject(thread);
  if (!reactionSubject?.nodeId) {
    operations.push(createNoop(action, 'reaction_subject_missing'));
  } else if (!hasViewerThumbsUp(reactionSubject.reactionGroups)) {
    operations.push({
      actionId: action.actionId,
      targetNodeId: action.target.nodeId,
      kind: 'react',
      reaction: DONE_REACTION_CONTENT,
      subjectNodeId: reactionSubject.nodeId,
    });
  } else {
    operations.push(createNoop(action, 'reaction_exists'));
  }

  if (!thread.isResolved) {
    operations.push({
      actionId: action.actionId,
      targetNodeId: action.target.nodeId,
      kind: 'resolve_thread',
    });
  } else {
    operations.push(createNoop(action, 'thread_resolved'));
  }

  return operations;
}

function planStandaloneOperations(action, viewerLogin, standalone) {
  const operations = [];
  const doneBody = buildDoneReplyBody(action.actionId);
  const hasDoneReply = hasDoneReplyFromViewer(standalone.replies, viewerLogin, action.actionId);

  if (hasDoneReply) {
    operations.push(createNoop(action, 'standalone_done_reply_exists'));
  } else {
    operations.push({
      actionId: action.actionId,
      targetNodeId: action.target.nodeId,
      kind: 'reply',
      body: doneBody,
      mutationTargetKind: action.target.kind,
    });
  }

  if (!hasViewerThumbsUp(standalone.reactionGroups)) {
    operations.push({
      actionId: action.actionId,
      targetNodeId: action.target.nodeId,
      kind: 'react',
      reaction: DONE_REACTION_CONTENT,
      subjectNodeId: action.target.nodeId,
    });
  } else {
    operations.push(createNoop(action, 'reaction_exists'));
  }

  return operations;
}

function planReviewActionOperations({ reviewActions, viewerLogin, githubState }) {
  assertReviewActionsV1(reviewActions);
  if (typeof viewerLogin !== 'string' || viewerLogin.length === 0) {
    throw new TypeError('viewerLogin must be a non-empty string');
  }

  const { threadIndex, standaloneIndex } = buildStateIndex(githubState);
  const operations = [];

  for (const action of reviewActions.actions) {
    if (action.decision !== 'will_address') {
      operations.push(createNoop(action, 'decision_not_will_address'));
      continue;
    }
    if (action.status !== 'done') {
      operations.push(createNoop(action, 'status_not_done'));
      continue;
    }

    if (action.target.kind === 'review_thread') {
      const thread = threadIndex.get(action.target.nodeId);
      if (!thread) {
        operations.push(createNoop(action, 'thread_state_missing'));
        continue;
      }
      operations.push(...planThreadOperations(action, viewerLogin, thread));
      continue;
    }

    const standalone = standaloneIndex.get(action.target.nodeId);
    if (!standalone) {
      operations.push(createNoop(action, 'standalone_state_missing'));
      continue;
    }
    operations.push(...planStandaloneOperations(action, viewerLogin, standalone));
  }

  return operations;
}

export {
  DONE_REACTION_CONTENT,
  buildDoneMarker,
  buildDoneReplyBody,
  hasDonePrefix,
  planReviewActionOperations,
};
