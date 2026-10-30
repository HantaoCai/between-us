# 答题题库（GitHub 静态托管）

约 **2000** 道中文四选一（无英文）。线上默认 jsDelivr：

`https://cdn.jsdelivr.net/gh/HantaoCai/between-us@main/public/quiz-bank`

开局：拉 `index.json` → 算法抽 N 个 id → 再拉相关分类 JSON 按 id 取题。

来源见 [SOURCES.md](./SOURCES.md)。

## 增补题目

编辑分类 JSON，字段：`id` / `cat` / `q` / `options[4]` / `answer(0-3)`。

然后：

```bash
npm run quiz:index
```

推送到 GitHub 后 CDN 才会更新。可用 `VITE_QUIZ_BANK_BASE` 覆盖地址。
