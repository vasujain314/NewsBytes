require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const Parser = require('rss-parser');
const cron = require('node-cron');

const bot = new Telegraf(process.env.BOT_TOKEN);
const parser = new Parser();
const express = require('express');
const app = express();

// A dummy page so the bot looks like a website
app.get('/', (req, res) => {
    res.send('Bot is running!');
});

// Render assigns a dynamic port, so we must use process.env.PORT
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
// --- STATE ---
const userPreferences = new Map();
const selectionSession = new Map();

const AVAILABLE_TOPICS = [
    "Technology", "Business", "Sports", "Health",
    "Science", "Entertainment", "Crypto", "World News"
];

// --- HELPER FUNCTIONS ---

async function fetchMixedNews(topics) {
    const storiesPerTopic = Math.ceil(8 / topics.length); // Aim for 8 total
    let allArticles = [];

    const promises = topics.map(async (topic) => {
        try {
            const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-IN&gl=IN&ceid=IN:en`;
            const feed = await parser.parseURL(feedUrl);
            
            // We ONLY take title, link, and date now
            return feed.items.slice(0, storiesPerTopic).map(item => ({
                topic: topic,
                heading: item.title,
                url: item.link,
                date: new Date(item.pubDate)
            }));
        } catch (e) {
            console.error(`Error fetching ${topic}:`, e);
            return [];
        }
    });

    const results = await Promise.all(promises);
    results.forEach(articles => allArticles.push(...articles));
    
    // Sort Newest -> Oldest
    allArticles.sort((a, b) => b.date - a.date);
    
    // Return top 8
    return allArticles.slice(0, 8);
}

function renderTelegramMessage(newsData, topics) {
    if (!newsData || newsData.length === 0) {
        return "⚠️ No news found right now.";
    }

    let message = `☕ **Your Daily Digest**\n`;
    message += `_Topics: ${topics.join(', ')}_\n\n`;

    newsData.forEach(item => {
        // CLEAN FORMAT: 
        // 🔹 Headline
        // [Read more](link)
        message += `🔹 *${item.heading}*\n`;
        message += `[Read more](${item.url})\n\n`;
    });

    message += `📅 _You will receive this daily at 9:00 AM._`;
    return message;
}

async function sendDigestToUser(chatId) {
    const topics = userPreferences.get(chatId);
    if (!topics || topics.length === 0) {
        return bot.telegram.sendMessage(chatId, "⚠️ Use /update to setup your topics.");
    }

    await bot.telegram.sendMessage(chatId, "🔍 Fetching latest headlines...");

    const newsData = await fetchMixedNews(topics);
    const finalMessage = renderTelegramMessage(newsData, topics);
    
    await bot.telegram.sendMessage(chatId, finalMessage, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: false 
    });
}

// --- KEYBOARD & MENUS (Standard) ---

function getTopicKeyboard(selectedTopics) {
    const buttons = AVAILABLE_TOPICS.map(topic => {
        const isSelected = selectedTopics.has(topic);
        return Markup.button.callback(isSelected ? `✅ ${topic}` : topic, `toggle_${topic}`);
    });
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
    rows.push([Markup.button.callback("🚀 Done & Fetch News", "done_selection")]);
    return Markup.inlineKeyboard(rows);
}

const showMenu = (ctx) => {
    const chatId = ctx.chat.id;
    const existingTopics = userPreferences.get(chatId) || [];
    const initialSet = new Set(existingTopics);
    selectionSession.set(chatId, initialSet);
    ctx.reply("⚙️ Configure Your Feed", getTopicKeyboard(initialSet));
};

bot.start((ctx) => showMenu(ctx));
bot.command('update', (ctx) => showMenu(ctx));

bot.action(/^toggle_(.+)$/, async (ctx) => {
    const topic = ctx.match[1];
    const chatId = ctx.chat.id;
    let selected = selectionSession.get(chatId) || new Set();
    if (selected.has(topic)) selected.delete(topic);
    else selected.add(topic);
    selectionSession.set(chatId, selected);
    try { await ctx.editMessageReplyMarkup(getTopicKeyboard(selected).reply_markup); } catch (e) {}
    await ctx.answerCbQuery();
});

bot.action("done_selection", async (ctx) => {
    const chatId = ctx.chat.id;
    const selected = selectionSession.get(chatId);
    if (!selected || selected.size === 0) return ctx.answerCbQuery("Select at least one!");
    userPreferences.set(chatId, Array.from(selected));
    selectionSession.delete(chatId);
    await ctx.editMessageText(`✅ Preferences Updated!`);
    await sendDigestToUser(chatId);
});

// --- SCHEDULER ---
cron.schedule('0 9 * * *', async () => {
    console.log('⏰ Running daily digest job at 9 AM...');
    for (const [chatId, _] of userPreferences.entries()) {
        await sendDigestToUser(chatId);
    }
}, { timezone: "Asia/Kolkata" });

bot.telegram.setMyCommands([
    { command: 'start', description: 'Restart bot' },
    { command: 'update', description: 'Change topics' }
]);

bot.launch();
console.log('🤖 Bot is running (Headlines Only Mode)...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));