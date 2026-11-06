import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ??= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ??= 'z'.repeat(32);

const ca = await import('../src/server/chatActions.ts');
const sf = await import('../src/server/socialFormats.ts');
const pricing = await import('../src/server/aiPricing.ts');
pricing.setCreditValueForTests(149 / 20000);


test('batch: each post is priced with its own media — writing + images + video', () => {
  const e = ca.estimateToolCredits('create_posts_batch', { posts: [
    { platform: 'linkedin', format: 'text', topic: 'a' },
    { platform: 'instagram', format: 'carousel', slides: 4, topic: 'b' },
    { platform: 'instagram', format: 'reel', topic: 'c' },
  ] });
  const expected = sf.socialCopyCredits() * 3 + 4 * sf.socialImageCredits() + (sf.socialImageCredits() + sf.socialVideoCredits());
  assert.equal(e?.credits, expected);
  assert.match(String(e?.label), /3 posts across 2 platforms/);
  assert.ok(e?.lines.some((l) => /Instagram carousel \(4 slides\)/.test(l)));
});

test('batch: one native post per platform; formats the platform cannot do are corrected', () => {
  const posts = ca.batchPosts({ posts: [{ topic: 'launch', platforms: ['Instagram', 'twitter'], format: 'text' }, { topic: 'tips', platform: 'tiktok', format: 'carousel' }] });
  assert.deepEqual(posts.map((p) => `${p.platform}:${p.format}`), ['instagram:single_image', 'x:text', 'tiktok:video']);
  assert.equal(posts[0].scheduled_at.slice(0, 10), posts[1].scheduled_at.slice(0, 10), 'the same idea goes out the same day on both platforms, each at its best time');
});

test('formats: carousels keep 3-10 slides, X captions fit 280 characters', () => {
  assert.equal(sf.clampSlides(1), 3);
  assert.equal(sf.clampSlides(40), 10);
  const text = sf.publishText('x', { caption: 'a'.repeat(300), hashtags: ['launch'] });
  assert.ok(text.length <= 280);
  assert.equal(sf.publishText('instagram', { caption: 'Hello', hashtags: ['one', 'two'] }), 'Hello\n\n#one #two');
  assert.equal(sf.normalizeFormat('instagram', 'text'), 'single_image', 'Instagram is never text-only');
  assert.equal(sf.aspectRatioFor('instagram', 'reel'), '9:16');
});

test('formats: the writer reply is parsed into caption, hashtags and slides', () => {
  const p = sf.parsePiece('Sure! {"title":"T","caption":"Cap","hashtags":["#a","b c"],"slides":[{"headline":"H1","body":""},{"headline":"H2","body":"B"}],"visual_style":"pastel"}', 'carousel', 5);
  assert.equal(p.caption, 'Cap');
  assert.deepEqual(p.hashtags, ['a', 'bc']);
  assert.equal(p.slides.length, 2);
  assert.equal(p.visual_style, 'pastel');
});

test('custom instructions block tells every agent to obey them', () => {
  assert.equal(ca.customInstructionsBlock(''), '');
  assert.match(ca.customInstructionsBlock('Always add an image'), /EVERY task[\s\S]*Always add an image/);
});

test('batch: posts without a usable time go to the platform\'s best slot in the user\'s timezone; empty briefs are dropped', () => {
  const now = new Date('2026-11-02T15:00:00Z'); // a Monday
  const posts = ca.batchPosts({ timezone: 'America/New_York', posts: [
    { platform: 'instagram', format: 'single_image', topic: 'one' },
    { platform: 'instagram', topic: '' },
    { platform: 'linkedin', format: 'text', topic: 'two', scheduled_at: '2020-01-01T00:00:00Z' },
    { platform: 'x', format: 'text', topic: 'three', scheduled_at: '2026-12-01T10:00:00Z' },
  ] }, now);
  assert.deepEqual(posts.map((p) => p.topic), ['one', 'two', 'three']);
  // Instagram: Tue 3 Nov, 11:00 New York (EST, UTC-5).
  assert.equal(posts[0].scheduled_at, '2026-11-03T16:00:00.000Z');
  // LinkedIn, entry 3 → from Thu 5 Nov; Tue–Thu only at 08:30 → Thu 5 Nov 08:30 EST.
  assert.equal(posts[1].scheduled_at, '2026-11-05T13:30:00.000Z', 'a past date falls back to the best slot');
  assert.equal(posts[2].scheduled_at, '2026-12-01T10:00:00.000Z', "the planner's own time is kept");
  assert.ok(posts.every((p) => !p.as_draft), 'every post is scheduled unless asked otherwise');
});

test('scheduling: LinkedIn skips the weekend, best slots respect the timezone', () => {
  const fri = new Date('2026-11-06T12:00:00Z');
  const slot = sf.bestSlot('linkedin', 1, 'Europe/London', fri);
  assert.equal(slot.toISOString(), '2026-11-10T08:30:00.000Z', 'Sat → next Tuesday 08:30 London');
  assert.equal(sf.validTimeZone('Not/AZone'), 'UTC');
});

test('batch: capped at the maximum', () => {
  const posts = ca.batchPosts({ posts: Array.from({ length: ca.BATCH_MAX_POSTS + 20 }, (_, i) => ({ topic: `t${i}` })) });
  assert.equal(posts.length, ca.BATCH_MAX_POSTS);
});

test('spending tools are priced; free tools and non-run Magnific actions are not', () => {
  assert.equal(ca.estimateToolCredits('magnific_lip_sync', {})?.credits, pricing.creditsForMagnific(30 * 180));
  assert.equal(ca.estimateToolCredits('magnific_edit_image', { type: 'remove-background' })?.credits, pricing.creditsForMagnific(3));
  assert.equal(ca.estimateToolCredits('magnific_one_generate', { mode: 'draft' })?.credits, pricing.creditsForMagnific(250));
  assert.equal(ca.estimateToolCredits('create_draft', { title: 'x' }), null);
  assert.equal(ca.estimateToolCredits('magnific_space_or_flow', { action: 'simulate_cost' }), null);
  assert.equal(ca.estimateToolCredits('magnific_space_or_flow', { action: 'run_flow' })?.credits, pricing.creditsForMagnific(1500));
});

test('saved sessions drop pasted image data', () => {
  const out = ca.sanitizeSessionMessages([{ kind: 'text', images: [{ id: '1', name: 'a.png', dataUrl: 'data:image/png;base64,AAAA' }] }]) as any[];
  assert.equal(out[0].images[0].dataUrl, '');
  assert.equal(out[0].images[0].name, 'a.png');
});

test('pricing: every AI cost is charged at cost × 1.54 or more, at the cheapest credit price', () => {
  const v = 149 / 20000;
  const check = (usd: number, label: string) => {
    const credits = pricing.creditsForUsd(usd);
    assert.ok(credits * v >= usd * 1.54 - 1e-9, `${label}: ${credits} credits ($${(credits * v).toFixed(4)}) < $${(usd * 1.54).toFixed(4)}`);
  };
  for (const model of ['magnific-one', 'nano-banana-pro', 'flux-dev', 'z-image', 'runway-t2i', 'unknown-model']) check(pricing.magnificImageCost(model) * 0.001, model);
  for (const q of ['medium', 'high']) for (const r of ['1k', '2k', '4k']) check(pricing.magnificOneCost({ quality: q, resolution: r }) * 0.001, `magnific-one ${q} ${r}`);
  for (const model of ['seedance-2-5', 'kling-v2-6-pro', 'ltx-2-pro']) for (const d of [5, 10, 15]) check(pricing.magnificVideoCost(model, { duration: d }) * 0.001, `${model} ${d}s`);
  check(pricing.magnificLipSyncCost() * 0.001, 'lip sync');
  // Exact values for the social defaults: lowest cost = Magnific Z-Image (5 ≈ $0.005); best quality = Magnific One 2k medium (180); Kling 2.6 5 s (225).
  // Lowest cost: half the Best-quality image price, whatever model draws it.
  assert.equal(sf.socialImageCredits(), Math.floor(Math.ceil((0.18 * 1.54) / v) / 2));
  assert.equal(pricing.economyImageCharge(0), sf.socialImageCredits(), 'an image that cost nothing is still half price');
  assert.equal(pricing.economyImageCharge(500), 500, 'never below the model cost × 1.54');
  assert.equal(sf.socialImageCredits('quality'), Math.ceil((0.18 * 1.54) / v));
  assert.equal(sf.socialVideoCredits(), Math.ceil((0.225 * 1.54) / v));
  assert.equal(pricing.creditsForUsd(0), 0);
});

test('pricing: the estimate shown for a Magnific tool is what it charges, and follows duration', () => {
  const five = ca.estimateToolCredits('magnific_generate_video', { model: 'kling-v2-6-pro', duration: 5 })!.credits;
  const ten = ca.estimateToolCredits('magnific_generate_video', { model: 'kling-v2-6-pro', duration: 10 })!.credits;
  assert.ok(ten >= five * 2 - 1 && ten <= five * 2 + 1);
  assert.equal(ca.estimateToolCredits('magnific_one_generate', { quality: 'normal' })!.credits, pricing.creditsForMagnific(180));
});

test('media setting: lowest cost by default — cheapest image and video models unless a model is named or quality is chosen', () => {
  assert.equal(ca.defaultImageModel({}), 'nano-banana-pro', 'Lowest cost: Magnific Nano Banana Pro, never the free model');
  assert.equal(ca.defaultImageModel({ media_mode: 'quality' }), 'magnific-one');
  assert.equal(ca.defaultImageModel({ model: 'mystic' }), 'mystic', 'a model the user names wins');
  assert.equal(ca.defaultVideoModel({}), 'kling-v2-6-pro');
  assert.equal(ca.defaultVideoModel({ image_url: 'x' }), 'kling-v2-6-pro');
  const economy = ca.estimateToolCredits('create_posts_batch', { posts: [{ platform: 'instagram', format: 'carousel', slides: 5, topic: 't' }] })!.credits;
  const quality = ca.estimateToolCredits('create_posts_batch', { media_mode: 'quality', posts: [{ platform: 'instagram', format: 'carousel', slides: 5, topic: 't' }] })!.credits;
  assert.ok(economy < quality, `economy ${economy} vs quality ${quality}`);
  assert.equal(ca.estimateToolCredits('magnific_generate_image', {})!.credits, pricing.economyImageCredits(), 'default image on Lowest cost: half the Best-quality price');
  assert.equal(ca.estimateToolCredits('magnific_generate_image', { model: 'z-image' })!.credits, pricing.creditsForMagnific(5), 'a model the user names is priced at its own cost × 1.54');
  assert.equal(ca.normalizeMediaMode('anything'), 'economy');
});

test('video: Lowest cost uses Kling 2.6, Best quality Kling 3.0 at about twice the price — both at cost × 1.54 or more', () => {
  const v = 149 / 20000;
  assert.equal(ca.defaultVideoModel({ media_mode: 'quality' }), 'kling-3-0');
  assert.equal(ca.defaultVideoModel({ media_mode: 'economy' }), 'kling-v2-6-pro');
  assert.equal(ca.defaultVideoModel({ media_mode: 'quality', model: 'kling-v2-6-pro' }), 'kling-v2-6-pro', 'a model the user names wins');
  assert.equal(sf.socialVideoCredits('economy'), Math.ceil((0.225 * 1.54) / v));
  assert.equal(sf.socialVideoCredits('quality'), Math.ceil((0.45 * 1.54) / v));
  assert.ok(sf.socialVideoCredits('economy') * 2 >= sf.socialVideoCredits('quality') - 1, 'Lowest cost video is about half of Best quality');
  for (const mode of ['economy', 'quality'] as const) {
    assert.ok(sf.socialVideoCredits(mode) * v >= (mode === 'quality' ? 0.45 : 0.225) * 1.54 - 1e-9, `${mode} video never below cost × 1.54`);
  }
  const q = ca.estimateToolCredits('magnific_generate_video', { media_mode: 'quality' })!.credits;
  assert.equal(q, sf.socialVideoCredits('quality'), 'the chat video tool charges what the estimate shows');
});
