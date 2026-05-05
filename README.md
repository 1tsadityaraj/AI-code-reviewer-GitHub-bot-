<div align="center">
  <img src="./assets/demo-review.png" alt="AI Code Reviewer Bot Logo" width="120" />
  <h1>AI Code Reviewer GitHub Bot</h1>
  <p>An intelligent, zero-config GitHub App that automatically reviews pull requests using Google Gemini.</p>

  ![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
  ![Probot](https://img.shields.io/badge/Probot-000000?style=for-the-badge&logo=probot&logoColor=white)
  ![Google Gemini](https://img.shields.io/badge/Google_Gemini-8E75B2?style=for-the-badge&logo=googlegemini&logoColor=white)
  ![Railway](https://img.shields.io/badge/Railway-131415?style=for-the-badge&logo=railway&logoColor=white)
</div>

---

![Demo GIF placeholder](https://via.placeholder.com/800x400.png?text=Demo+GIF+Placeholder+—+Shows+bot+posting+an+inline+comment)

## ✨ Features

- **Inline PR Comments:** Analyzes diffs and posts precise, inline feedback directly on the changed lines of code.
- **Categorized Feedback:** Automatically detects and categorizes issues by Bugs, Security, Performance, Style, and Best Practices.
- **Severity Levels:** Tags every issue as 🔴 **Critical**, 🟡 **Warning**, or 🔵 **Suggestion**.
- **Commit Status Integration:** Automatically blocks PR merging (marks commit status as "failure") if any **Critical** issues are found.
- **On-Demand Re-reviews:** Type `/review` in a PR comment to manually trigger a fresh analysis.
- **Diff & File Limits:** Smartly skips massive PRs (>50 files) and truncates gigantic files to protect token limits and API costs.

## 🏗️ How It Works (Architecture)

1. **Webhook Trigger:** GitHub sends a webhook payload to the Probot server whenever a Pull Request is opened or synchronized.
2. **Fetch & Parse Diff:** The bot fetches the raw unified diff of the PR and parses it into structured file objects, filtering out lock files and binaries.
3. **Prompt Construction:** For each valid file, the bot chunks the diff and constructs a prompt embedding the PR context and a strict JSON schema.
4. **LLM Inference:** Google's `gemini-1.5-pro` model evaluates the diff against strict software engineering heuristics with a temperature of `0` for deterministic outputs.
5. **Mapping & Posting:** The bot safely parses the JSON response, maps the AI's flagged issues back to valid GitHub line numbers, and posts them via the GitHub API.

## 🚀 Setup & Local Development

1. **Clone & Install**
   ```bash
   git clone https://github.com/1tsadityaraj/AI-code-reviewer-GitHub-bot-.git
   cd AI-code-reviewer-GitHub-bot-
   npm install
   ```

2. **Create a GitHub App**
   - Go to your GitHub **Developer settings** -> **GitHub Apps** -> **New GitHub App**.
   - Enable Webhooks. For local dev, use a proxy like [smee.io](https://smee.io/).
   - **Permissions:**
     - Pull requests: Read & Write
     - Issues: Read & Write
     - Contents: Read-only
     - Commit statuses: Read & Write
   - **Events:** Subscribe to `pull_request` and `issue_comment`.

3. **Environment Configuration**
   Rename `.env.example` to `.env` and fill in the credentials:
   ```env
   APP_ID=your_github_app_id
   PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
   WEBHOOK_SECRET=your_webhook_secret
   GEMINI_API_KEY=your_gemini_api_key
   ```
   *(Note: The `PRIVATE_KEY` must have actual literal `\n` newline characters, not physical line breaks.)*

4. **Run the Bot**
   ```bash
   npm run dev
   ```

## ☁️ Deployment (Railway)

Deploying this bot to [Railway.app](https://railway.app/) is fast and requires zero extra config files since it automatically detects the Node.js environment.

1. Create a new project on Railway and select **Deploy from GitHub repo**.
2. Select this repository. Railway will automatically build it using Nixpacks and run `npm start`.
3. Go to the **Variables** tab in your Railway service and add all 4 variables from your `.env` file.
   - *Tip:* For `PRIVATE_KEY`, you can paste the multi-line `.pem` file content directly. Railway handles multi-line environment variables natively, so you don't need to replace line breaks with `\n`.
4. Go to the **Settings** tab in Railway, scroll to **Public Networking**, and click **Generate Domain**.
5. Copy that newly generated URL. Go back to your GitHub App settings on GitHub, and update the **Webhook URL** to your Railway domain.

## 🧠 What I Learned

Building this project taught me several deep architectural lessons:
- **Navigating the GitHub API ecosystem:** Learning the difference between Actions, OAuth Apps, and GitHub Apps, and mastering Probot's webhook abstraction.
- **Parsing Unified Diffs from Scratch:** Git diffs have a notorious, esoteric format. Writing a custom parser to track line numbers precisely was the hardest technical challenge, but crucial to preventing 422 API errors when posting inline comments.
- **LLM Output Determinism:** Getting an LLM to reliably return valid, parsable JSON without hallucinating or adding markdown fences requires strict prompt engineering, `responseMimeType` enforcement, and Zod fallback schema validation.
- **Defensive API Design:** Implementing protective guardrails (e.g., rejecting PRs > 50 files, chunking 300-line diffs) to prevent the bot from exceeding token quotas or DDOSing the LLM endpoints during large code refactors.

---
*Built with ❤️ by [Aditya Raj](https://github.com/1tsadityaraj)*
