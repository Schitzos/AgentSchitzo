import { loadEnvFile, readRequiredEnv } from "../utils/env.ts";

loadEnvFile();

const TELEGRAM_TOKEN = readRequiredEnv("TELEGRAM_TOKEN");
const TELEGRAM_CHAT_ID = readRequiredEnv("TELEGRAM_CHAT_ID");
const NEWS_API_KEY = process.env.NEWS_API_KEY || "";

interface Article {
  title: string;
  url: string;
}

async function fetchAiNews(): Promise<Article[]> {
  // Try NewsAPI if key is available
  if (NEWS_API_KEY) {
    const url = `https://newsapi.org/v2/everything?q=artificial+intelligence+OR+AI+OR+LLM+OR+machine+learning&sortBy=publishedAt&pageSize=10&language=en&apiKey=${NEWS_API_KEY}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      return (data.articles || []).slice(0, 10).map((a: any) => ({
        title: a.title,
        url: a.url,
      }));
    }
  }

  // Fallback: scrape Google News RSS for AI topics
  const rssUrl =
    "https://news.google.com/rss/search?q=artificial+intelligence+OR+AI+OR+LLM&hl=en-US&gl=US&ceid=US:en";
  const res = await fetch(rssUrl);
  const xml = await res.text();

  const items: Article[] = [];
  const itemRegex = /<item>[\s\S]*?<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < 10) {
    const titleMatch = match[0].match(/<title><!\[CDATA\[(.*?)\]\]>|<title>(.*?)<\/title>/);
    const linkMatch = match[0].match(/<link>(.*?)<\/link>|<link\/>\s*(https?[^\s<]+)/);
    const title = titleMatch?.[1] || titleMatch?.[2] || "Untitled";
    const link = linkMatch?.[1] || linkMatch?.[2] || "";
    if (link) items.push({ title, url: link });
  }

  return items;
}

async function sendTelegram(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
}

async function main() {
  const articles = await fetchAiNews();

  if (articles.length === 0) {
    await sendTelegram("⚠️ No AI news found today.");
    return;
  }

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  let message = `🤖 <b>Top ${articles.length} AI News — ${today}</b>\n\n`;
  articles.forEach((a, i) => {
    message += `${i + 1}. <a href="${a.url}">${escapeHtml(a.title)}</a>\n`;
  });

  await sendTelegram(message);
  console.log(`Sent ${articles.length} AI news articles.`);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

main().catch((err) => {
  console.error("daily-ai-news failed:", err);
  process.exit(1);
});
