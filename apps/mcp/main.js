'use strict';
// モデル②（ローカルMCP）: 共有コアを「mcp」モードで起動する。
// core/main/main.js が MODEL を見て、ローカル MCP サーバ（127.0.0.1:19790）を立て、
// 外部AIエージェント（Claude Code / Cursor 等）からタイムラインを操作できるようにする。
process.env.TELORA_MODEL = 'mcp';
require('../../packages/core/main/main.js');
