const REVIEW_STATE_VERSION = 1;
const REVIEW_ACTIONS_VERSION = 1;

const TARGET_KIND_VALUES = new Set([
  'review_thread',
  'review_comment',
  'pull_request_review',
  'issue_comment',
]);

const DECISION_VALUES = new Set([
  'will_address',
  'defer',
  'out_of_scope',
  'already_fixed',
  'not_actionable',
  'wont_address',
]);

const STATUS_VALUES = new Set(['pending', 'in_progress', 'done']);

function compareNullableStringsAsc(a, b) {
  const left = a ?? '';
  const right = b ?? '';
  return left.localeCompare(right);
}

function compareNullableNumbersAsc(a, b) {
  const left = a ?? Number.MAX_SAFE_INTEGER;
  const right = b ?? Number.MAX_SAFE_INTEGER;
  return left - right;
}

function stripReviewFrameworkMarkers(body) {
  if (typeof body !== 'string') {
    return '';
  }

  return body
    .replace(/<!--\s*review-framework:[\s\S]*?-->/g, '')
    .replace(/<!--\s*internal state start\s*-->[\s\S]*?<!--\s*internal state end\s*-->/g, '')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trimEnd();
}

function normalizeReactionGroups(groups) {
  if (!Array.isArray(groups)) {
    return [];
  }

  const normalized = groups.map((group) => ({
    content: String(group?.content ?? ''),
    users: {
      totalCount: Number.isFinite(group?.users?.totalCount) ? group.users.totalCount : 0,
    },
  }));

  normalized.sort((a, b) => a.content.localeCompare(b.content));
  return normalized;
}

function earliestCommentCreatedAt(comments) {
  if (!Array.isArray(comments) || comments.length === 0) {
    return null;
  }

  let earliest = null;
  for (const comment of comments) {
    if (typeof comment?.createdAt === 'string' && comment.createdAt.length > 0) {
      if (earliest === null || comment.createdAt < earliest) {
        earliest = comment.createdAt;
      }
    }
  }
  return earliest;
}

function sortThreadComments(comments) {
  return [...comments].sort((a, b) => {
    const createdAtOrder = compareNullableStringsAsc(a.createdAt, b.createdAt);
    if (createdAtOrder !== 0) {
      return createdAtOrder;
    }
    return compareNullableStringsAsc(a.nodeId, b.nodeId);
  });
}

function sortReviewThreads(threads) {
  return [...threads].sort((a, b) => {
    const pathOrder = compareNullableStringsAsc(a.path, b.path);
    if (pathOrder !== 0) {
      return pathOrder;
    }

    const startLineOrder = compareNullableNumbersAsc(a.startLine, b.startLine);
    if (startLineOrder !== 0) {
      return startLineOrder;
    }

    const earliestOrder = compareNullableStringsAsc(
      earliestCommentCreatedAt(a.comments),
      earliestCommentCreatedAt(b.comments),
    );
    if (earliestOrder !== 0) {
      return earliestOrder;
    }

    return compareNullableStringsAsc(a.nodeId, b.nodeId);
  });
}

function sortReviews(reviews) {
  return [...reviews].sort((a, b) => {
    const submittedAtOrder = compareNullableStringsAsc(a.submittedAt, b.submittedAt);
    if (submittedAtOrder !== 0) {
      return submittedAtOrder;
    }
    return compareNullableStringsAsc(a.nodeId, b.nodeId);
  });
}

function sortIssueComments(comments) {
  return [...comments].sort((a, b) => {
    const createdAtOrder = compareNullableStringsAsc(a.createdAt, b.createdAt);
    if (createdAtOrder !== 0) {
      return createdAtOrder;
    }
    return compareNullableStringsAsc(a.nodeId, b.nodeId);
  });
}

function normalizeAuthor(author) {
  return {
    login: typeof author?.login === 'string' ? author.login : null,
  };
}

function normalizeBody(body) {
  return stripReviewFrameworkMarkers(body ?? '');
}

function normalizeThreadComment(comment) {
  if (typeof comment?.id !== 'string' || comment.id.length === 0) {
    return null;
  }

  return {
    nodeId: comment.id,
    url: typeof comment.url === 'string' ? comment.url : null,
    author: normalizeAuthor(comment.author),
    createdAt: typeof comment.createdAt === 'string' ? comment.createdAt : null,
    body: normalizeBody(comment.body),
    reactionGroups: normalizeReactionGroups(comment.reactionGroups),
  };
}

function normalizeReview(review) {
  if (typeof review?.id !== 'string' || review.id.length === 0) {
    return null;
  }

  const body = normalizeBody(review.body);
  if (body.trim().length === 0) {
    return null;
  }

  return {
    nodeId: review.id,
    url: typeof review.url === 'string' ? review.url : null,
    author: normalizeAuthor(review.author),
    state: typeof review.state === 'string' ? review.state : null,
    submittedAt: typeof review.submittedAt === 'string' ? review.submittedAt : null,
    body,
    reactionGroups: normalizeReactionGroups(review.reactionGroups),
  };
}

function normalizeIssueComment(comment) {
  if (typeof comment?.id !== 'string' || comment.id.length === 0) {
    return null;
  }

  return {
    nodeId: comment.id,
    url: typeof comment.url === 'string' ? comment.url : null,
    author: normalizeAuthor(comment.author),
    createdAt: typeof comment.createdAt === 'string' ? comment.createdAt : null,
    body: normalizeBody(comment.body),
    reactionGroups: normalizeReactionGroups(comment.reactionGroups),
    replies: [],
  };
}

function normalizeReviewStateV1(input) {
  const normalizedThreads = [];
  const threadCandidates = Array.isArray(input?.reviewThreads) ? input.reviewThreads : [];
  for (const thread of threadCandidates) {
    if (thread?.isResolved !== false) {
      continue;
    }
    if (typeof thread?.id !== 'string' || thread.id.length === 0) {
      continue;
    }

    const normalizedComments = [];
    const commentCandidates = Array.isArray(thread?.comments?.nodes) ? thread.comments.nodes : [];
    for (const comment of commentCandidates) {
      const normalizedComment = normalizeThreadComment(comment);
      if (normalizedComment) {
        normalizedComments.push(normalizedComment);
      }
    }

    normalizedThreads.push({
      nodeId: thread.id,
      isResolved: false,
      isOutdated: Boolean(thread.isOutdated),
      path: typeof thread.path === 'string' ? thread.path : null,
      startLine:
        Number.isInteger(thread.startLine) && thread.startLine >= 0
          ? thread.startLine
          : Number.isInteger(thread.originalStartLine) && thread.originalStartLine >= 0
            ? thread.originalStartLine
            : null,
      endLine:
        Number.isInteger(thread.line) && thread.line >= 0
          ? thread.line
          : Number.isInteger(thread.originalLine) && thread.originalLine >= 0
            ? thread.originalLine
            : null,
      comments: sortThreadComments(normalizedComments),
    });
  }

  const normalizedReviews = [];
  const reviewCandidates = Array.isArray(input?.reviews) ? input.reviews : [];
  for (const review of reviewCandidates) {
    const normalizedReview = normalizeReview(review);
    if (normalizedReview) {
      normalizedReviews.push(normalizedReview);
    }
  }

  const normalizedIssueComments = [];
  const issueCommentCandidates = Array.isArray(input?.issueComments) ? input.issueComments : [];
  for (const issueComment of issueCommentCandidates) {
    const normalizedComment = normalizeIssueComment(issueComment);
    if (normalizedComment) {
      normalizedIssueComments.push(normalizedComment);
    }
  }

  const reviewState = {
    version: REVIEW_STATE_VERSION,
    fetchedAt: String(input?.fetchedAt ?? ''),
    sourceBranch: typeof input?.sourceBranch === 'string' ? input.sourceBranch : null,
    pr: {
      url: typeof input?.pr?.url === 'string' ? input.pr.url : null,
      nodeId: typeof input?.pr?.id === 'string' ? input.pr.id : null,
      number: Number.isInteger(input?.pr?.number) ? input.pr.number : null,
      title: typeof input?.pr?.title === 'string' ? input.pr.title : null,
      state: typeof input?.pr?.state === 'string' ? input.pr.state : null,
      headRefName: typeof input?.pr?.headRefName === 'string' ? input.pr.headRefName : null,
      baseRefName: typeof input?.pr?.baseRefName === 'string' ? input.pr.baseRefName : null,
      updatedAt: typeof input?.pr?.updatedAt === 'string' ? input.pr.updatedAt : null,
    },
    reviewThreads: sortReviewThreads(normalizedThreads),
    reviews: sortReviews(normalizedReviews),
    issueComments: sortIssueComments(normalizedIssueComments),
  };

  return reviewState;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function validateReactionGroupShape(group, pointer) {
  if (!isNonEmptyString(group?.content)) {
    throw new TypeError(`${pointer}.content must be a non-empty string`);
  }
  if (!Number.isInteger(group?.users?.totalCount) || group.users.totalCount < 0) {
    throw new TypeError(`${pointer}.users.totalCount must be a non-negative integer`);
  }
}

function validateBodyEntryShape(entry, pointer) {
  if (!isNonEmptyString(entry?.nodeId)) {
    throw new TypeError(`${pointer}.nodeId must be a non-empty string`);
  }
  if (entry.url !== null && entry.url !== undefined && typeof entry.url !== 'string') {
    throw new TypeError(`${pointer}.url must be string or null`);
  }
  if (typeof entry?.author !== 'object' || entry.author === null) {
    throw new TypeError(`${pointer}.author must be an object`);
  }
  if (entry.author.login !== null && entry.author.login !== undefined && typeof entry.author.login !== 'string') {
    throw new TypeError(`${pointer}.author.login must be string or null`);
  }
  if (entry.createdAt !== null && entry.createdAt !== undefined && typeof entry.createdAt !== 'string') {
    throw new TypeError(`${pointer}.createdAt must be string or null`);
  }
  if (typeof entry.body !== 'string') {
    throw new TypeError(`${pointer}.body must be a string`);
  }
  if (!Array.isArray(entry.reactionGroups)) {
    throw new TypeError(`${pointer}.reactionGroups must be an array`);
  }
  for (let index = 0; index < entry.reactionGroups.length; index += 1) {
    validateReactionGroupShape(entry.reactionGroups[index], `${pointer}.reactionGroups[${index}]`);
  }
}

function assertReviewStateV1(reviewState) {
  if (typeof reviewState !== 'object' || reviewState === null) {
    throw new TypeError('review-state must be an object');
  }
  if (reviewState.version !== REVIEW_STATE_VERSION) {
    throw new TypeError(`review-state version must be ${REVIEW_STATE_VERSION}`);
  }
  if (!isNonEmptyString(reviewState.fetchedAt)) {
    throw new TypeError('review-state fetchedAt must be a non-empty string');
  }
  if (reviewState.sourceBranch !== null && reviewState.sourceBranch !== undefined && typeof reviewState.sourceBranch !== 'string') {
    throw new TypeError('review-state sourceBranch must be string or null');
  }

  const pr = reviewState.pr;
  if (typeof pr !== 'object' || pr === null) {
    throw new TypeError('review-state pr must be an object');
  }
  if (pr.url !== null && pr.url !== undefined && typeof pr.url !== 'string') {
    throw new TypeError('review-state pr.url must be string or null');
  }
  if (!isNonEmptyString(pr.nodeId)) {
    throw new TypeError('review-state pr.nodeId must be a non-empty string');
  }

  if (!Array.isArray(reviewState.reviewThreads)) {
    throw new TypeError('review-state reviewThreads must be an array');
  }
  for (let index = 0; index < reviewState.reviewThreads.length; index += 1) {
    const thread = reviewState.reviewThreads[index];
    const pointer = `review-state reviewThreads[${index}]`;
    if (!isNonEmptyString(thread?.nodeId)) {
      throw new TypeError(`${pointer}.nodeId must be a non-empty string`);
    }
    if (thread?.isResolved !== false) {
      throw new TypeError(`${pointer}.isResolved must be false`);
    }
    if (typeof thread?.isOutdated !== 'boolean') {
      throw new TypeError(`${pointer}.isOutdated must be boolean`);
    }
    if (thread.path !== null && thread.path !== undefined && typeof thread.path !== 'string') {
      throw new TypeError(`${pointer}.path must be string or null`);
    }
    if (thread.startLine !== null && thread.startLine !== undefined && !Number.isInteger(thread.startLine)) {
      throw new TypeError(`${pointer}.startLine must be integer or null`);
    }
    if (thread.endLine !== null && thread.endLine !== undefined && !Number.isInteger(thread.endLine)) {
      throw new TypeError(`${pointer}.endLine must be integer or null`);
    }
    if (!Array.isArray(thread.comments)) {
      throw new TypeError(`${pointer}.comments must be an array`);
    }
    for (let commentIndex = 0; commentIndex < thread.comments.length; commentIndex += 1) {
      validateBodyEntryShape(
        thread.comments[commentIndex],
        `${pointer}.comments[${commentIndex}]`,
      );
    }
  }

  if (!Array.isArray(reviewState.reviews)) {
    throw new TypeError('review-state reviews must be an array');
  }
  for (let index = 0; index < reviewState.reviews.length; index += 1) {
    const review = reviewState.reviews[index];
    validateBodyEntryShape(review, `review-state reviews[${index}]`);
    if (review.state !== null && review.state !== undefined && typeof review.state !== 'string') {
      throw new TypeError(`review-state reviews[${index}].state must be string or null`);
    }
    if (review.submittedAt !== null && review.submittedAt !== undefined && typeof review.submittedAt !== 'string') {
      throw new TypeError(`review-state reviews[${index}].submittedAt must be string or null`);
    }
  }

  if (!Array.isArray(reviewState.issueComments)) {
    throw new TypeError('review-state issueComments must be an array');
  }

  const validateIssueComment = (comment, pointer) => {
    validateBodyEntryShape(comment, pointer);
    if (!Array.isArray(comment.replies)) {
      throw new TypeError(`${pointer}.replies must be an array`);
    }
    for (let index = 0; index < comment.replies.length; index += 1) {
      validateIssueComment(comment.replies[index], `${pointer}.replies[${index}]`);
    }
  };

  for (let index = 0; index < reviewState.issueComments.length; index += 1) {
    validateIssueComment(reviewState.issueComments[index], `review-state issueComments[${index}]`);
  }

  return reviewState;
}

function assertReviewActionsV1(reviewActions) {
  if (typeof reviewActions !== 'object' || reviewActions === null) {
    throw new TypeError('review-actions must be an object');
  }
  if (reviewActions.version !== REVIEW_ACTIONS_VERSION) {
    throw new TypeError(`review-actions version must be ${REVIEW_ACTIONS_VERSION}`);
  }

  if (typeof reviewActions.pr !== 'object' || reviewActions.pr === null) {
    throw new TypeError('review-actions pr must be an object');
  }
  if (!isNonEmptyString(reviewActions.pr.url)) {
    throw new TypeError('review-actions pr.url must be a non-empty string');
  }
  if (reviewActions.pr.nodeId !== undefined && reviewActions.pr.nodeId !== null && !isNonEmptyString(reviewActions.pr.nodeId)) {
    throw new TypeError('review-actions pr.nodeId must be a non-empty string when provided');
  }

  if (typeof reviewActions.reviewState !== 'object' || reviewActions.reviewState === null) {
    throw new TypeError('review-actions reviewState must be an object');
  }
  if (!isNonEmptyString(reviewActions.reviewState.path)) {
    throw new TypeError('review-actions reviewState.path must be a non-empty string');
  }
  if (!isNonEmptyString(reviewActions.reviewState.fetchedAt)) {
    throw new TypeError('review-actions reviewState.fetchedAt must be a non-empty string');
  }
  if (reviewActions.reviewState.digest !== undefined && reviewActions.reviewState.digest !== null && !isNonEmptyString(reviewActions.reviewState.digest)) {
    throw new TypeError('review-actions reviewState.digest must be a non-empty string when provided');
  }

  if (!Array.isArray(reviewActions.actions)) {
    throw new TypeError('review-actions actions must be an array');
  }

  const seenActionIds = new Set();
  for (let index = 0; index < reviewActions.actions.length; index += 1) {
    const action = reviewActions.actions[index];
    const pointer = `review-actions actions[${index}]`;

    if (!isNonEmptyString(action?.actionId)) {
      throw new TypeError(`${pointer}.actionId must be a non-empty string`);
    }
    if (seenActionIds.has(action.actionId)) {
      throw new TypeError(`${pointer}.actionId must be unique`);
    }
    seenActionIds.add(action.actionId);

    if (typeof action?.target !== 'object' || action.target === null) {
      throw new TypeError(`${pointer}.target must be an object`);
    }
    if (!TARGET_KIND_VALUES.has(action.target.kind)) {
      throw new TypeError(`${pointer}.target.kind must be a supported value`);
    }
    if (!isNonEmptyString(action.target.nodeId)) {
      throw new TypeError(`${pointer}.target.nodeId must be a non-empty string`);
    }
    if (action.target.url !== undefined && action.target.url !== null && !isNonEmptyString(action.target.url)) {
      throw new TypeError(`${pointer}.target.url must be a non-empty string when provided`);
    }

    if (!DECISION_VALUES.has(action?.decision)) {
      throw new TypeError(`${pointer}.decision must be a supported value`);
    }
    if (!isNonEmptyString(action?.summary)) {
      throw new TypeError(`${pointer}.summary must be a non-empty string`);
    }
    if (action.decision === 'wont_address' && !isNonEmptyString(action?.rationale)) {
      throw new TypeError(`${pointer}.rationale must be a non-empty string when decision is wont_address`);
    }
    if (action.rationale !== undefined && action.rationale !== null && typeof action.rationale !== 'string') {
      throw new TypeError(`${pointer}.rationale must be string or null`);
    }
    if (!STATUS_VALUES.has(action?.status)) {
      throw new TypeError(`${pointer}.status must be one of pending|in_progress|done`);
    }
    if (action.targetFiles !== undefined) {
      if (!Array.isArray(action.targetFiles)) {
        throw new TypeError(`${pointer}.targetFiles must be an array when provided`);
      }
      for (let fileIndex = 0; fileIndex < action.targetFiles.length; fileIndex += 1) {
        if (!isNonEmptyString(action.targetFiles[fileIndex])) {
          throw new TypeError(`${pointer}.targetFiles[${fileIndex}] must be a non-empty string`);
        }
      }
    }
    if (action.acceptance !== undefined && action.acceptance !== null && typeof action.acceptance !== 'string') {
      throw new TypeError(`${pointer}.acceptance must be string or null`);
    }

    if (action.done !== undefined && action.done !== null) {
      if (typeof action.done !== 'object') {
        throw new TypeError(`${pointer}.done must be object or null`);
      }
      if (action.done.doneAt !== undefined && action.done.doneAt !== null && !isNonEmptyString(action.done.doneAt)) {
        throw new TypeError(`${pointer}.done.doneAt must be a non-empty string when provided`);
      }
      if (action.done.summary !== undefined && action.done.summary !== null && !isNonEmptyString(action.done.summary)) {
        throw new TypeError(`${pointer}.done.summary must be a non-empty string when provided`);
      }
      if (action.done.commits !== undefined) {
        if (!Array.isArray(action.done.commits)) {
          throw new TypeError(`${pointer}.done.commits must be an array when provided`);
        }
        for (let commitIndex = 0; commitIndex < action.done.commits.length; commitIndex += 1) {
          if (!isNonEmptyString(action.done.commits[commitIndex])) {
            throw new TypeError(`${pointer}.done.commits[${commitIndex}] must be a non-empty string`);
          }
        }
      }
    }
  }

  return reviewActions;
}

function formatCanonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export {
  REVIEW_ACTIONS_VERSION,
  REVIEW_STATE_VERSION,
  assertReviewActionsV1,
  assertReviewStateV1,
  formatCanonicalJson,
  normalizeReactionGroups,
  normalizeReviewStateV1,
  sortIssueComments,
  sortReviewThreads,
  sortReviews,
  sortThreadComments,
  stripReviewFrameworkMarkers,
};
