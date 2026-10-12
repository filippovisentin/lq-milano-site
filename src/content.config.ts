import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Products and events are plain Markdown files, edited by hand or through the
// admin panel at /admin (Sveltia CMS, see public/admin/config.yml).

export const CATEGORIES = ['Capispalla', 'Maglieria e polo', 'Camicie', 'Pantaloni e gonne', 'Accessori', 'Altro'] as const;

const products = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/products' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      price: z.number().nonnegative(),
      size: z.string().nullish(),
      category: z.enum(CATEGORIES).default('Altro'),
      available: z.boolean().default(true),
      quantity: z.number().int().nonnegative().default(1),
      order: z.number().default(999),
      featured: z.boolean().default(false),
      images: z.array(image()).min(1),
      details: z
        .object({
          misure: z.array(z.string()).default([]),
          materiale: z.array(z.string()).default([]),
          stato: z.string().nullish(),
          anni: z.string().nullish(),
        })
        .default({ misure: [], materiale: [] }),
      model3d: z
        .object({
          front: z.string().nullish(),
          back: z.string().nullish(),
          disabled: z.boolean().default(false),
        })
        .optional(),
      seoDescription: z.string().optional(),
    }),
});

const events = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/events' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      start: z.coerce.date(),
      end: z.coerce.date().nullish(),
      poster: image(),
      venue: z.string().default('Via Giulio e Corrado Venini, 54'),
      registration: z.enum(['aperta', 'chiusa', 'esaurita']).default('chiusa'),
      registrationUrl: z.string().url().nullish(),
      tagline: z.string().nullish(),
    }),
});

export const collections = { products, events };
