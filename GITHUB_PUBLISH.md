# Publishing Orc Torrent to GitHub

Use these steps to upload this repo to GitHub. You need [Git](https://git-scm.com/download/win) installed.

## 1. Create a new repository on GitHub

1. Go to [github.com/new](https://github.com/new).
2. **Repository name:** e.g. `Orc-Torrent`.
3. **Description:** e.g. `Decentralized BitTorrent client with privacy-focused features`.
4. Choose **Public**.
5. **Do not** initialize with a README, .gitignore, or license (this repo already has them).
6. Click **Create repository**.

## 2. Initialize Git and push (first time)

In a terminal, from this project folder:

```powershell
cd "c:\Users\eli\Downloads\Orc Torrent\Orc Torrent"

# Initialize Git (if not already)
git init

# Add all files (respects .gitignore)
git add .

# First commit
git commit -m "Initial commit: Orc Torrent 2.2.14"

# Add your GitHub repo as remote (replace YOUR_USERNAME and REPO_NAME with yours)
git remote add origin https://github.com/YOUR_USERNAME/Orc-Torrent.git

# Rename branch to main if needed, then push
git branch -M main
git push -u origin main
```

Use your GitHub username and the repo name you created. If you use SSH:

```powershell
git remote add origin git@github.com:YOUR_USERNAME/Orc-Torrent.git
```

## 3. Create a release (optional)

- In GitHub: **Releases** → **Create a new release**.
- Tag: e.g. `v2.2.14`.
- Or push a tag from the repo: `git tag v2.2.14` then `git push origin v2.2.14`.

The workflow in `.github/workflows/build-release.yml` will run on tag push and attach Windows installer/zip to the release (after you run the workflow once and artifacts are produced).

## 4. Update README repo link

After the repo is created, if the URL differs from `https://github.com/The-animus-project/Orc-Torrent`, update the **Repository:** link in [README.md](README.md) to your actual repo URL.

---

**Already have Git and a remote?** Just run:

```powershell
git add .
git status   # review what will be committed
git commit -m "Your message"
git push
```
