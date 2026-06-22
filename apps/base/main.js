'use strict';
// モデル①（ベース）: 追加機能なしで共有コア（packages/core）をそのまま起動する。
// core/main/main.js は __dirname 相対で preload・renderer を読むため、ここから require するだけで動く。
require('../../packages/core/main/main.js');
