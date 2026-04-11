export function createTelegramApi({
  fetchFn = fetch,
  token,
  chatId,
  logger = console
}) {
  function buildTelegramUrl(method, query = "") {
    return `https://api.telegram.org/bot${token}/${method}${query}`;
  }

  async function getUpdates(offset) {
    try {
      const res = await fetchFn(buildTelegramUrl("getUpdates", `?offset=${offset + 1}`));

      const data = await res.json();

      if (!data.ok) {
        logger.log("Telegram API error:", data);
        return [];
      }

      return data.result || [];
    } catch (err) {
      logger.log("Fetch error:", err.message);
      return [];
    }
  }

  async function sendMessage(text) {
    await fetchFn(buildTelegramUrl("sendMessage"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    });
  }

  return {
    getUpdates,
    sendMessage
  };
}
