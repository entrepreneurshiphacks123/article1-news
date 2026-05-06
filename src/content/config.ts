import { defineCollection, z } from 'astro:content';

const slideSchema = z.object({
  kind: z.enum(['hook', 'context', 'pattern', 'stakes', 'watch', 'sources', 'cta']),
  body: z.string(),
});

const sourceCitation = z.object({
  outlet: z.string(),
  url: z.string().optional(),
  date: z.string().optional(),
  note: z.string().optional(),
});

const posts = defineCollection({
  type: 'content',
  schema: z.object({
    id: z.number(),
    type: z.enum(['static', 'carousel']),
    date: z.string().transform((s) => new Date(s)),
    headline: z.string(),
    tags: z.array(z.string()).default([]),
    source: z.object({
      outlet: z.string(),
      url: z.string().optional(),
    }),
    body: z.string().optional(),
    slides: z.array(slideSchema).optional(),
    citations: z.array(sourceCitation).optional(),
    hashtags: z.array(z.string()).default([]),
    race_level: z.enum(['national', 'state', 'local', 'none']).default('none'),
  }),
});

export const collections = { posts };
