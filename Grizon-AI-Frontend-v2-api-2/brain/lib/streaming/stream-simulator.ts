/**
 * Simulates a realistic token-by-token streaming effect from an LLM.
 */
export async function* simulateStream(
    text: string,
    options: { minDelay?: number; maxDelay?: number; chunkSize?: number } = {}
) {
    const minDelay = options.minDelay ?? 10;
    const maxDelay = options.maxDelay ?? 40;
    const chunkSize = options.chunkSize ?? 3; // number of characters per tick to make it feel natural

    let i = 0;
    while (i < text.length) {
        // Random delay between min and max
        const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        
        // Wait for the delay
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Yield chunk
        const chunk = text.slice(i, i + chunkSize);
        yield chunk;
        
        i += chunkSize;
    }
}
