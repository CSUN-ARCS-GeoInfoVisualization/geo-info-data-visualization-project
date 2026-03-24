# Git workflow: news work and `main`

## Branches

- **`main`** — integration branch; keep it deployable.
- **`feature/news`** — ongoing fire/news work (API, `fire_news` services, `fire-news` UI, `newsApi`, tests).

Develop news changes on **`feature/news`** (or short-lived branches such as `feature/news-<topic>` merged into `feature/news` first). When a chunk is ready, integrate into **`main`**.

## Merge into `main`

**Locally:**

```bash
git checkout main
git pull origin main
git merge feature/news
```

**On GitHub:** open a pull request **from `feature/news` into `main`**, review, then merge.

## Before merging

- Backend: `cd backend && py -m pytest tests/test_news.py` (or full suite).
- Frontend: `cd frontend && npm run build`.

## Pushing the news branch

If using the project remote:

```bash
git push -u origin feature/news
```

`origin` must be set (`git remote -v`). First-time setup: `git remote add origin <repository-url>`.

## Stashed WIP

If you had uncommitted work stashed while switching branches (e.g. `git stash list`), restore it on the branch where you want those changes:

```bash
git checkout feature/news
git stash pop   # or: git stash apply stash@{n}
```

Use `git stash list` to pick the right entry.
