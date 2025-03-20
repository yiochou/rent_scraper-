import { Router } from "itty-router";
import * as cheerio from "cheerio";

const router = Router();

async function sendTelegramMessage(env, message) {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const body = {
        chat_id: env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "Markdown"
    };

    await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
}

async function fetchRentData() {
	const urls = [
		"https://rent.591.com.tw/list?region=1&section=1,4,10,11,3&price=20000_30000,30000_40000&other=balcony_1,newPost&sort=posttime_desc",
		"https://rent.591.com.tw/list?region=1&section=5,1,7,2&price=20000_30000,30000_40000&other=balcony_1,newPost&sort=posttime_desc",
		"https://rent.591.com.tw/list?region=3&section=26,38,37,34,45&price=20000_30000,30000_40000&other=balcony_1,newPost&sort=posttime_desc",
	]
	const listings = []

	for (const url of urls) {
		const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });

		if (!response.ok) {
			return { error: "Failed to fetch 591 data" };
		}

		const html = await response.text();
		const $ = cheerio.load(html);

		$(".item").each((i, el) => {
			const title = $(el).find(".item-info-title").text().trim();
			const info = $(el).find(".item-info-txt").toArray().map(e => $(e).text().trim()).join('/')
			const link = $(el).find("a").attr("href");
			const id = link.match(/(?<=rent\.591\.com\.tw\/)\d+/g)?.[0] || ""; // 提取房源 ID

			listings.push({
				id,
				title,
				info,
				url: link
			});
		});
	}

    return listings.reverse()
}

export default {
    async fetch(request, env) {
        return await processRentData(env);
    },
    async scheduled(event, env, ctx) {
        console.log("⏰ 定時任務觸發！");
        await processRentData(env);  // 執行主要邏輯
    }
};

// 抽出主要邏輯，讓 `fetch()` 和 `scheduled()` 都能使用
async function processRentData(env) {
    const latestListings = await fetchRentData();
    if (!latestListings || latestListings.length === 0) {
        return new Response("No new data.", { status: 200 });
    }

    // 讀取已發送的租屋 ID
    const sentListingsRaw = await env.RENT_DATA.get("sent_listings", { type: "json" }) || [];
    const sentListings = new Set(sentListingsRaw);

    // 過濾未發送過的房源
    const newListings = latestListings.filter(listing => !sentListings.has(listing.id));

    if (newListings.length > 0) {
        const message = newListings.map(post => 
            `🏡 *${post.title}*\n 📍 資訊: ${post.info}\n🔗 [查看房源](${post.url})`
        ).join("\n\n");

        // 發送 Telegram 通知
        await sendTelegramMessage(env, message);

        // ⚠ 修正這裡：更新 `sent_listings` 時，存入 RENT_DATA
        const updatedSentListings = [...sentListings, ...newListings.map(l => l.id)];
        await env.RENT_DATA.put("sent_listings", JSON.stringify(updatedSentListings));
    }

    return new Response("Data processed!", { status: 200 });
}