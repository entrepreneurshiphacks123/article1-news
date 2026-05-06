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

const quoteSchema = z.object({
  text: z.string(),                  // the snippet (3-5 sentences typical)
  speaker: z.string(),               // "Barack Obama"
  speaker_title: z.string().optional(),  // "Former President of the United States"
  via: z.string().optional(),        // "in an interview with Stephen Colbert"
});

const numbersSchema = z.object({
  value: z.string(),                 // "$100M" or "87%" or "46-year"
  unit: z.string().optional(),       // optional descriptor below value, e.g. "high"
  body: z.string(),                  // 1-3 sentences of context
});

const headlineSchema = z.object({
  text: z.string(),                  // the original headline being highlighted
  outlet: z.string(),                // "WTVF Nashville · May 6, 2026"
  url: z.string().optional(),        // direct link to the original story
});

const cartoonSchema = z.object({
  image_url: z.string(),             // direct image URL (Wikimedia / LOC)
  alt: z.string(),                   // accessible alt text describing the cartoon
  artist: z.string(),                // "Thomas Nast"
  year: z.string(),                  // "1871"
  publication: z.string(),           // "Harper's Weekly"
  source_url: z.string().optional(), // catalog page (LOC, Wikimedia Commons)
});

const posts = defineCollection({
  type: 'content',
  schema: z.object({
    id: z.number(),
    type: z.enum(['static', 'carousel', 'quote', 'numbers', 'headline', 'cartoon']),
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

    // Type-specific payloads (only one applies based on `type`).
    quote: quoteSchema.optional(),
    numbers: numbersSchema.optional(),
    headline_card: headlineSchema.optional(),
    cartoon: cartoonSchema.optional(),
  }),
});

export const collections = { posts };
