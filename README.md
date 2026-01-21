# aitest
用来做各种各样的ai项目测试

## YouTube Podcast -> Article
输入 YouTube 播客地址，抓取逐字稿并生成文章。支持自定义风格、长度与输出语言。

### Features
- Paste a YouTube URL to fetch the transcript.
- Generate a structured article in a chosen style.
- Optional OpenAI integration with a rule-based fallback.

### Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. (Optional) Create a `.env` file:
   ```bash
   OPENAI_API_KEY=your_api_key_here
   OPENAI_MODEL=gpt-4o-mini
   PORT=3000
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Open `http://localhost:3000` in your browser.

### Notes
- YouTube captions must be available for the video.
- If no OpenAI key is set, the app uses a local rule-based draft.
- Long transcripts are truncated for processing.
