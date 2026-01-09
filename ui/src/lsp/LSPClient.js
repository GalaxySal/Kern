import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

class LSPClient {
  constructor() {
    this.connections = new Map();
    this.languageServers = new Map();
    this.setupLanguageServers();
  }

  setupLanguageServers() {
    // Common language server configurations
    this.languageServers.set('javascript', {
      command: 'typescript-language-server',
      args: ['--stdio'],
      fileExtensions: ['.js', '.jsx'],
      languageId: 'javascript'
    });

    this.languageServers.set('typescript', {
      command: 'typescript-language-server',
      args: ['--stdio'],
      fileExtensions: ['.ts', '.tsx'],
      languageId: 'typescript'
    });

    this.languageServers.set('python', {
      command: 'pylsp',
      args: [],
      fileExtensions: ['.py'],
      languageId: 'python'
    });

    this.languageServers.set('rust', {
      command: 'rust-analyzer',
      args: [],
      fileExtensions: ['.rs'],
      languageId: 'rust'
    });
  }

  async startLanguageServer(filePath, editor) {
    const language = this.detectLanguage(filePath);
    if (!language) return;

    const serverConfig = this.languageServers.get(language);
    if (!serverConfig) return;

    // Check if server is already running
    if (this.connections.has(language)) {
      this.connectEditorToServer(editor, language);
      return;
    }

    try {
      // Create connection to language server
      const serverOptions = {
        command: serverConfig.command,
        args: serverConfig.args
      };

      const clientOptions = {
        documentSelector: [{ scheme: 'file', language: serverConfig.languageId }],
        synchronize: {
          configurationSection: [serverConfig.languageId]
        },
        diagnosticCollectionName: serverConfig.languageId,
        progressOnInitialization: true,
        workspaceFolder: {
          uri: `file://${this.getProjectRoot(filePath)}`,
          name: 'Kern Project'
        }
      };

      // Create and start the client
      const client = await this.createLanguageClient(serverOptions, clientOptions);
      const connection = await client.start();

      this.connections.set(language, { client, connection });
      this.connectEditorToServer(editor, language);

      console.log(`LSP server started for ${language}`);
    } catch (error) {
      console.error(`Failed to start LSP server for ${language}:`, error);
    }
  }

  async createLanguageClient(serverOptions, clientOptions) {
    // Implementation depends on the environment
    // For Tauri, we need to handle the connection differently
    if (window.__TAURI__) {
      return this.createTauriLanguageClient(serverOptions, clientOptions);
    } else {
      return this.createWebLanguageClient(serverOptions, clientOptions);
    }
  }

  async createTauriLanguageClient(serverOptions, clientOptions) {
    // For Tauri, we'll use a simplified approach
    // The actual LSP communication will be handled by the Rust backend
    return {
      start: async () => {
        // Notify Rust backend to start LSP server
        await window.__TAURI__.invoke('start_lsp_server', {
          command: serverOptions.command,
          args: serverOptions.args,
          language: clientOptions.documentSelector[0].language
        });
        return { dispose: () => { } };
      }
    };
  }

  async createWebLanguageClient(serverOptions, _clientOptions) {
    // For web version, use direct WebSocket or stdio communication
    // This is a simplified version - real implementation would need proper WebSocket handling
    return {
      start: async () => {
        console.log('Starting LSP server for web:', serverOptions);
        return { dispose: () => { } };
      }
    };
  }

  connectEditorToServer(editor, language) {
    // Set up Monaco editor to work with LSP
    editor.getModel();

    // Clear existing providers to avoid duplicates
    monaco.languages.setLanguageConfiguration(language, {
      comments: {
        blockComment: ['/*', '*/'],
        lineComment: '//'
      },
      brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')']
      ],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" }
      ]
    });

    // Configure Monaco for LSP integration
    const completionProvider = monaco.languages.registerCompletionItemProvider(language, {
      provideCompletionItems: async (model, position, _context, _token) => {
        try {
          // Get word at position for context
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn
          };

          // This would be populated by the actual LSP server
          // For now, return basic completions
          return {
            suggestions: this.getBasicCompletions(language, word.word).map(comp => ({
              ...comp,
              range,
              insertText: comp.insertText || comp.label,
              detail: comp.detail || `Basic ${comp.kind}`,
              documentation: comp.documentation || `Documentation for ${comp.label}`
            }))
          };
        } catch (error) {
          console.error('Completion provider error:', error);
          return { suggestions: [] };
        }
      }
    });

    const hoverProvider = monaco.languages.registerHoverProvider(language, {
      provideHover: async (model, position, _token) => {
        try {
          const word = model.getWordAtPosition(position);
          if (word) {
            return {
              range: new monaco.Range(
                position.lineNumber,
                word.startColumn,
                position.lineNumber,
                word.endColumn
              ),
              contents: [
                { value: `**${word.word}**` },
                { value: `Basic documentation for \`${word.word}\`` }
              ]
            };
          }
          return null;
        } catch (error) {
          console.error('Hover provider error:', error);
          return null;
        }
      }
    });

    const definitionProvider = monaco.languages.registerDefinitionProvider(language, {
      provideDefinition: async (model, position, _token) => {
        try {
          const word = model.getWordAtPosition(position);
          if (word) {
            // This would be populated by the actual LSP server
            // For now, return null (no definition)
            return null;
          }
          return null;
        } catch (error) {
          console.error('Definition provider error:', error);
          return null;
        }
      }
    });

    const signatureHelpProvider = monaco.languages.registerSignatureHelpProvider(language, {
      signatureHelpTriggerCharacters: ['(', ','],
      provideSignatureHelp: async (_model, _position, _token, _context) => {
        return null;
      }
    });

    // Store providers for cleanup
    if (!this.providers) {
      this.providers = new Map();
    }
    this.providers.set(language, {
      completion: completionProvider,
      hover: hoverProvider,
      definition: definitionProvider,
      signatureHelp: signatureHelpProvider
    });
  }

  getBasicCompletions(language, prefix) {
    const completions = {
      javascript: [
        { label: 'function', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'function ${1:name}() {\n\t${2:// body}\n}', detail: 'Function declaration', documentation: 'Creates a function' },
        { label: 'const', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'const ${1:name} = ${2:value};', detail: 'Constant declaration', documentation: 'Declares a constant variable' },
        { label: 'let', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'let ${1:name} = ${2:value};', detail: 'Variable declaration', documentation: 'Declares a block-scoped variable' },
        { label: 'if', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'if (${1:condition}) {\n\t${2:// body}\n}', detail: 'If statement', documentation: 'Conditional statement' },
        { label: 'for', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'for (${1:i} = 0; ${2:i} < ${3:array}.length; ${4:i}++) {\n\t${5:// body}\n}', detail: 'For loop', documentation: 'Iterates over a range' },
        { label: 'console.log', kind: monaco.languages.CompletionItemKind.Function, insertText: 'console.log(${1:value});', detail: 'Console output', documentation: 'Logs to the console' },
        { label: 'async', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'async ', detail: 'Async keyword', documentation: 'Marks a function as asynchronous' },
        { label: 'await', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'await ', detail: 'Await keyword', documentation: 'Waits for a Promise' },
        { label: 'try', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'try {\n\t${1:// code}\n} catch (${2:error}) {\n\t${3:// handle error}\n}', detail: 'Try-catch block', documentation: 'Error handling' },
        { label: 'class', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'class ${1:ClassName} {\n\tconstructor(${2:params}) {\n\t\t${3:// body}\n\t}\n}', detail: 'Class declaration', documentation: 'Creates a class' }
      ],
      typescript: [
        { label: 'interface', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'interface ${1:Name} {\n\t${2:property}: ${3:type};\n}', detail: 'Interface declaration', documentation: 'Defines an interface' },
        { label: 'type', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'type ${1:Name} = ${2:type};', detail: 'Type alias', documentation: 'Creates a type alias' },
        { label: 'class', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'class ${1:Name} {\n\tconstructor(${2:params}) {\n\t\t${3:// body}\n\t}\n}', detail: 'Class declaration', documentation: 'Creates a class' },
        { label: 'enum', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'enum ${1:Name} {\n\t${2:VALUE1},\n\t${3:VALUE2}\n}', detail: 'Enum declaration', documentation: 'Creates an enumeration' }
      ],
      python: [
        { label: 'def', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'def ${1:function_name}(${2:args}):\n\t${3:pass}', detail: 'Function definition', documentation: 'Defines a function' },
        { label: 'class', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'class ${1:ClassName}:\n\tdef __init__(self${2:, args}):\n\t\t${3:pass}', detail: 'Class definition', documentation: 'Defines a class' },
        { label: 'import', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'import ${1:module}', detail: 'Import statement', documentation: 'Imports a module' },
        { label: 'from', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'from ${1:module} import ${2:name}', detail: 'From import', documentation: 'Imports specific names from a module' },
        { label: 'if', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'if ${1:condition}:\n\t${2:pass}', detail: 'If statement', documentation: 'Conditional statement' },
        { label: 'for', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'for ${1:item} in ${2:iterable}:\n\t${3:pass}', detail: 'For loop', documentation: 'Iterates over items' },
        { label: 'print', kind: monaco.languages.CompletionItemKind.Function, insertText: 'print(${1:value})', detail: 'Print function', documentation: 'Outputs to console' },
        { label: 'try', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'try:\n\t${1:# code}\nexcept ${2:Exception} as ${3:e}:\n\t${4:# handle error}', detail: 'Try-except block', documentation: 'Error handling' }
      ],
      rust: [
        { label: 'fn', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'fn ${1:function_name}(${2:params}) -> ${3:return_type} {\n\t${4:// body}\n}', detail: 'Function definition', documentation: 'Defines a function' },
        { label: 'struct', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'struct ${1:StructName} {\n\t${2:field}: ${3:Type},\n}', detail: 'Struct definition', documentation: 'Defines a struct' },
        { label: 'impl', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'impl ${1:Trait} for ${2:Struct} {\n\t${3:// body}\n}', detail: 'Implementation block', documentation: 'Implements traits or methods' },
        { label: 'let', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'let ${1:name}: ${2:Type} = ${3:value};', detail: 'Variable binding', documentation: 'Declares a variable' },
        { label: 'match', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'match ${1:value} {\n\t${2:pattern} => ${3:result},\n}', detail: 'Match expression', documentation: 'Pattern matching' },
        { label: 'println!', kind: monaco.languages.CompletionItemKind.Function, insertText: 'println!("${1:message}", ${2:args});', detail: 'Print macro', documentation: 'Prints to console' },
        { label: 'use', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'use ${1:path}::${2:item};', detail: 'Use statement', documentation: 'Imports items' },
        { label: 'pub', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'pub ', detail: 'Public visibility', documentation: 'Makes items public' }
      ]
    };

    const langCompletions = completions[language] || [];

    // Filter by prefix
    return langCompletions.filter(comp =>
      comp.label.toLowerCase().startsWith(prefix.toLowerCase())
    );
  }

  detectLanguage(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    const languageMap = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'rs': 'rust',
      'go': 'go',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'cpp',
      'h': 'cpp',
      'cs': 'csharp',
      'php': 'php',
      'rb': 'ruby',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'html': 'html',
      'css': 'css',
      'json': 'json',
      'xml': 'xml',
      'yaml': 'yaml',
      'yml': 'yaml',
      'toml': 'toml',
      'md': 'markdown'
    };

    return languageMap[ext] || null;
  }

  getProjectRoot(filePath) {
    // Simple heuristic: find the nearest directory with common project markers
    const path = filePath.split('/');
    for (let i = path.length - 1; i >= 0; i--) {
      const currentPath = path.slice(0, i).join('/');
      if (this.isProjectRoot(currentPath)) {
        return currentPath;
      }
    }
    return path.slice(0, -1).join('/'); // Return parent directory
  }

  isProjectRoot(path) {
    const markers = [
      'package.json',
      'Cargo.toml',
      'pyproject.toml',
      'requirements.txt',
      'setup.py',
      'go.mod',
      'pom.xml',
      'build.gradle',
      '.git',
      'tsconfig.json',
      'jsconfig.json'
    ];

    // This would need to be implemented with actual file system checks
    return markers.some(marker => `${path}/${marker}`.exists);
  }

  async stopLanguageServer(language) {
    const connection = this.connections.get(language);
    if (connection) {
      try {
        await connection.client.stop();
        this.connections.delete(language);

        // Clean up Monaco providers
        if (this.providers && this.providers.has(language)) {
          const providers = this.providers.get(language);
          Object.values(providers).forEach(provider => {
            if (provider && typeof provider.dispose === 'function') {
              provider.dispose();
            }
          });
          this.providers.delete(language);
        }

        console.log(`LSP server stopped for ${language}`);
      } catch (error) {
        console.error(`Failed to stop LSP server for ${language}:`, error);
      }
    }
  }

  async stopAllServers() {
    const promises = Array.from(this.connections.keys()).map(language =>
      this.stopLanguageServer(language)
    );
    await Promise.all(promises);
  }
}

export default LSPClient;
