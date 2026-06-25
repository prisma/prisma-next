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

// Display schema path in header
const pathEl = document.getElementById('schema-path');
if (pathEl !== null) {
  pathEl.textContent = schemaPath;
}

// Configure Monaco workers for classic mode (no TextMate/extension host)
function configureWorkerFactory(logger?: ILogger): void {
  const workerLoaders = defineDefaultWorkerLoaders();
  // Remove workers not needed for classic mode
  workerLoaders['TextMateWorker'] = undefined;
  workerLoaders['extensionHostWorkerMain'] = undefined;
  const config = logger !== undefined ? { workerLoaders, logger } : { workerLoaders };
  useWorkerFactory(config);
}

// Build WebSocket URL from page origin
function buildWebSocketUrl(): string {
  const host = `${window.location.host}${wsPath}`;
  // nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket -- localhost dev playground; scheme mirrors page origin
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

  // Register the schema file in a virtual file system so Monaco can open it
  const fileUri = vscode.Uri.parse(documentUri);
  const fileSystemProvider = new RegisteredFileSystemProvider(false);
  fileSystemProvider.registerFile(new RegisteredMemoryFile(fileUri, schemaText));
  registerFileSystemOverlay(1, fileSystemProvider);

  // Configure monaco-vscode-api (classic mode, no full VS Code extensions)
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
        'workbench.colorTheme': 'Default Dark Modern',
        'editor.wordBasedSuggestions': 'off',
        'editor.minimap.enabled': false,
        'editor.folding': true,
        'editor.foldingStrategy': 'auto',
        'editor.showFoldingControls': 'always',
      }),
    },
    monacoWorkerFactory: configureWorkerFactory,
  };

  // Configure connection to language server via WebSocket
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

  // Configure the editor with the schema content
  const editorAppConfig: EditorAppConfig = {
    codeResources: {
      modified: {
        text: schemaText,
        uri: fileUri.path,
      },
    },
    languageDef: {
      languageExtensionConfig: {
        id: LANGUAGE_ID,
        extensions: ['.psl', '.prisma'],
        aliases: ['Prisma Schema Language', 'PSL'],
      },
    },
  };

  // Start monaco-vscode-api first (must happen once per page lifecycle)
  const apiWrapper = new MonacoVscodeApiWrapper(vscodeApiConfig);
  await apiWrapper.start();

  // Create and start the editor
  const editorApp = new EditorApp(editorAppConfig);
  await editorApp.start(htmlContainer);

  // Create and start the language client
  const languageClientWrapper = new LanguageClientWrapper(languageClientConfig);
  await languageClientWrapper.start();

  // Open the document so the language server sees it
  await vscode.workspace.openTextDocument(fileUri);

  // Wire up the format button to Monaco's format action
  formatButton.addEventListener('click', async () => {
    await vscode.commands.executeCommand('editor.action.formatDocument');
  });
}

main().catch(console.error);
