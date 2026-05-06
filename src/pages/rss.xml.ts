import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = await getCollection('posts');
  const sorted = [...posts].sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  return rss({
    title: 'Article I',
    description: 'American politics through the lens of the Constitution and the long memory.',
    site: context.site!,
    stylesheet: '/rss-styles.xsl',
    items: sorted.map((p) => ({
      title: p.data.headline,
      link: `/posts/${p.slug}`,
      pubDate: p.data.date,
      description: p.data.type === 'static'
        ? (p.data.body ?? '')
        : ((p.data.slides ?? []).find((s) => s.kind === 'hook')?.body ?? ''),
      categories: p.data.tags,
    })),
    customData: '<language>en-us</language>',
  });
}
