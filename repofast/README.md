# RepoFast
Upload Once. Organize Everything. Push to GitHub.

Static web app (HTML/CSS/vanilla JS). It calls the GitHub API directly from the browser,
so there is no backend and no database. Your Personal Access Token is stored only in this
browser's localStorage and is sent only to api.github.com. "Disconnect" removes it.

## Run locally
    npx serve .        # then open the printed URL

## Deploy to Vercel
    npx vercel --prod  (or import the folder in the Vercel dashboard; no build step)

## Token permissions
- Classic PAT: scope `repo`
- Fine-grained PAT: Contents (read/write) + Administration (read/write, to create repos)
