import 'dotenv/config';
import { getPool } from './src/db/pool.js';
import { messageService } from './src/services/message.service.js';

async function run() {
    const pool = getPool();
    try {
        const userId = '7d7f7751-b8df-4843-99ae-4d8a4382be06';
        const convId = 'd454b609-b8be-48e8-ab4c-00972a445fce';
        console.log("Fetching messages...");
        const msgs = await messageService.listForConversation({
            userId,
            conversationId: convId,
            limit: 100
        });
        console.log("Success! Found", msgs.items.length, "messages.");
    } catch(e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}
run();
