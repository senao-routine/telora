'use strict';
// AI版（②MCP＋③チャットの合体）: 共有コアを「ai」モードで起動する。
// - ローカルMCPサーバを立て、ユーザー自身のAIエージェント（Claude Code/Cursor等）から操作できる
// - 同時にアプリ内AIチャットパネルも使える（自分のAPIキー/ローカルモデル）
// 両方の入口を1つのアプリに集約。
process.env.TELORA_MODEL = 'ai';
require('../../packages/core/main/main.js');
