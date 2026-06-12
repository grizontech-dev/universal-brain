import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: '*',
            allow: '/',
            disallow: [
                '/chat/',
                '/api/',
                '/auth/', // Assuming auth routes might exist or be added
                '/_next/', // Next.js internals
            ],
        },
        // sitemap: 'https://your-domain.com/sitemap.xml',
    };
}
