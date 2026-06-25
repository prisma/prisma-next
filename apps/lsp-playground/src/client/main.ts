import { LogLevel } from '@codingame/monaco-vscode-api';
import {
  RegisteredFileSystemProvider,
  RegisteredMemoryFile,
  registerFileSystemOverlay,
} from '@codingame/monaco-vscode-files-service-override';
import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override';
import type { ILogger } from '@codingame/monaco-vscode-log-service-override';
import { EditorApp, type EditorAppConfig } from 'monaco-languageclient/editorApp';
import { type LanguageClientConfig, LanguageClientWrapper } from 'monaco-languageclient/lcwrapper';
import {
  type MonacoVscodeApiConfig,
  MonacoVscodeApiWrapper,
} from 'monaco-languageclient/vscodeApiWrapper';
import { defineDefaultWorkerLoaders, useWorkerFactory } from 'monaco-languageclient/workerFactory';
import * as vscode from 'vscode';
import { documentUri, rootUri, schemaPath, schemaText, wsPath } from './runtime';

const LANGUAGE_ID = 'prisma';

const pathEl = document.getElementById('schema-path');
if (pathEl !== null) {
  pathEl.textContent = schemaPath;
}

function configureWorkerFactory(logger?: ILogger): void {
  const workerLoaders = defineDefaultWorkerLoaders();
  workerLoaders['TextMateWorker'] = undefined;
  workerLoaders['extensionHostWorkerMain'] = undefined;
  const config = logger !== undefined ? { workerLoaders, logger } : { workerLoaders };
  useWorkerFactory(config);
}

function buildWebSocketUrl(): string {
  const host = `${window.location.host}${wsPath}`;
  // nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket
  return window.location.protocol === 'https:' ? `wss://${host}` : `ws://${host}`;
}

async function main(): Promise<void> {
  const htmlContainer = document.getElementById('editor');
  if (htmlContainer === null) {
    throw new Error('#editor mount point not found');
  }

  const formatButton = document.getElementById('format-document');
  if (!(formatButton instanceof HTMLButtonElement)) {
    throw new Error('#format-document button not found');
  }

  const fileUri = vscode.Uri.parse(documentUri);
  const fileSystemProvider = new RegisteredFileSystemProvider(false);
  fileSystemProvider.registerFile(new RegisteredMemoryFile(fileUri, schemaText));
  registerFileSystemOverlay(1, fileSystemProvider);

  const vscodeApiConfig: MonacoVscodeApiConfig = {
    $type: 'classic',
    viewsConfig: {
      $type: 'EditorService',
      htmlContainer,
    },
    logLevel: LogLevel.Warning,
    serviceOverrides: {
      ...getKeybindingsServiceOverride(),
    },
    userConfiguration: {
      json: JSON.stringify({
        'editor.wordBasedSuggestions': 'off',
      }),
    },
    monacoWorkerFactory: configureWorkerFactory,
  };

  const wsUrl = buildWebSocketUrl();
  const languageClientConfig: LanguageClientConfig = {
    languageId: LANGUAGE_ID,
    connection: {
      options: {
        $type: 'WebSocketUrl',
        url: wsUrl,
        startOptions: {
          onCall: () => console.log('Connected to language server'),
          reportStatus: true,
        },
        stopOptions: {
          onCall: () => console.log('Disconnected from language server'),
          reportStatus: true,
        },
      },
    },
    clientOptions: {
      documentSelector: [LANGUAGE_ID],
      workspaceFolder: {
        index: 0,
        name: 'workspace',
        uri: vscode.Uri.parse(rootUri),
      },
    },
  };

  const editorAppConfig: EditorAppConfig = {
    codeResources: {
      modified: {
        text: schemaText,
        uri: fileUri.path,
      },
    },
    editorOptions: {
      theme: 'vs-dark',
      fontSize: 16,
      lineHeight: 24,
      fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Monaco, monospace',
      minimap: { enabled: false },
      folding: true,
      foldingStrategy: 'auto',
      showFoldingControls: 'always',
    },
    languageDef: {
      languageExtensionConfig: {
        id: LANGUAGE_ID,
        extensions: ['.psl', '.prisma'],
        aliases: ['Prisma Schema Language', 'PSL'],
      },
    },
  };

  const apiWrapper = new MonacoVscodeApiWrapper(vscodeApiConfig);
  await apiWrapper.start();

  const editorApp = new EditorApp(editorAppConfig);
  await editorApp.start(htmlContainer);

  const languageClientWrapper = new LanguageClientWrapper(languageClientConfig);
  await languageClientWrapper.start();

  await vscode.workspace.openTextDocument(fileUri);

  formatButton.addEventListener('click', async () => {
    await vscode.commands.executeCommand('editor.action.formatDocument');
  });
}

main().catch(console.error);
