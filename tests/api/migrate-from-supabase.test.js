// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { githubProfile, remapPosts, supabaseImageUrls } from '../../scripts/migrate-from-supabase.mjs'

const SB = 'https://proj.supabase.co/storage/v1/object/public/draft-images/u1/d1/a.png'

describe('githubProfile', () => {
  it('maps GitHub metadata to a users row', () => {
    expect(
      githubProfile({
        id: 'u1',
        raw_user_meta_data: { provider_id: '4242', user_name: 'octo', full_name: 'Octo', avatar_url: 'https://a' }
      })
    ).toEqual({ id: 'u1', github_id: '4242', login: 'octo', name: 'Octo', avatar_url: 'https://a' })
  })

  it('falls back to sub and returns null without a numeric GitHub id', () => {
    expect(githubProfile({ id: 'u2', raw_user_meta_data: { sub: '77' } })?.github_id).toBe('77')
    expect(githubProfile({ id: 'u3', raw_user_meta_data: { provider_id: 'abc' } })).toBeNull()
    expect(githubProfile({ id: 'u4', raw_user_meta_data: null })).toBeNull()
  })
})

describe('image URL helpers', () => {
  it('finds Supabase image URLs in string and object entries only', () => {
    const posts = [{ images: [SB, { url: SB }, 'https://elsewhere.test/x.png'] }, { text: 'no images' }]
    expect(supabaseImageUrls(posts)).toEqual([SB, SB])
  })

  it('rewrites both entry shapes and leaves posts without images alone', () => {
    const map = new Map([[SB, 'https://store.public.blob.vercel-storage.com/new.png']])
    const posts = [{ id: 'p', images: [SB, { url: SB, uploadMethod: 'file' }] }, { id: 'q', text: 'x' }]
    expect(remapPosts(posts, map)).toEqual([
      {
        id: 'p',
        images: [
          'https://store.public.blob.vercel-storage.com/new.png',
          { url: 'https://store.public.blob.vercel-storage.com/new.png', uploadMethod: 'file' }
        ]
      },
      { id: 'q', text: 'x' }
    ])
  })
})

describe('sourceConfig', () => {
  it('drops sslmode from the URL and sets an explicit ssl option', async () => {
    const { sourceConfig } = await import('../../scripts/migrate-from-supabase.mjs')
    const cfg = sourceConfig('postgresql://u:p@host.example:5432/postgres?sslmode=require')
    expect(cfg.connectionString).not.toContain('sslmode')
    expect(cfg.connectionString).toContain('host.example:5432/postgres')
    expect(cfg.ssl).toEqual({ rejectUnauthorized: false })
  })
})
