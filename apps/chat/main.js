'use strict';
// モデル③（アプリ内AIチャット）: 共有コアを「chat」モードで起動する。
// renderer 側でチャットパネルが立ち上がり、アプリ内LLMが EditCommands を function calling で叩く。
process.env.TELORA_MODEL = 'chat';
require('../../packages/core/main/main.js');
