import {identity, db, json, error, input, HttpError} from '@/lib/service';
import {parseCorpusToMessages} from '@/evaluation/fact-checker';
import {indexStep} from '@/lib/retrieval';

/**
 * Evaluation setup endpoint
 * POST /api/eval-setup
 *
 * Actions:
 * - setup: Create profile, source, and messages for evaluation
 * - cleanup: Remove all evaluation data for given history IDs
 * - clear-cache: Clear retrieval cache and turns for clean evaluation
 */
export async function POST(request: Request) {
  try {
    const owner = await identity();
    const p = await input(request);

    if (!['setup', 'cleanup', 'clear-cache'].includes(p.action)) {
      throw new HttpError(400, 'Invalid action. Must be setup, cleanup, or clear-cache.');
    }

    if (p.action === 'setup') {
      // Setup evaluation data
      if (!p.historyId || !p.historyName || !p.relationship || !p.corpusText) {
        throw new HttpError(400, 'Missing required fields for setup.');
      }

      const profileId = `eval-${p.historyId}`;
      const sourceId = p.historyId;

      // 1. Create or update profile
      // Schema: id, owner, name, relationship, context, created, version, summary, summary_version, summary_error
      await db().prepare(`
        INSERT OR REPLACE INTO profiles (id, owner, name, relationship, context, version, created, summary_version)
        VALUES (?, ?, ?, ?, ?, 1, datetime('now'), 0)
      `).bind(
        profileId,
        owner,
        p.historyName,
        p.relationship,
        `Evaluation profile for ${p.historyId}`
      ).run();

      // 2. Create or update source
      // Schema: id, profile_id, owner, filename, hash, raw, created, version
      await db().prepare(`
        INSERT OR REPLACE INTO sources (id, profile_id, owner, filename, hash, raw, version, created)
        VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
      `).bind(
        sourceId,
        profileId,
        owner,
        `${p.historyId}.txt`,
        'eval-source',
        p.corpusText
      ).run();

      // 3. Parse and insert messages (with batching to avoid "too many SQL variables")
      const messages = parseCorpusToMessages(p.corpusText, sourceId, profileId);

      // Clear old messages first
      await db().prepare(`DELETE FROM messages WHERE owner=? AND profile_id=? AND source_id=?`)
        .bind(owner, profileId, sourceId)
        .run();

      // Insert messages in batches of 5 to avoid D1 SQL variable limit (max ~100 variables)
      // Each message has 9 parameters, so 5 messages = 45 variables
      const BATCH_SIZE = 5;
      for (let i = 0; i < messages.length; i += BATCH_SIZE) {
        const batch = messages.slice(i, i + BATCH_SIZE);

        // Build batch insert statement
        const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const values = batch.flatMap(msg => [
          msg.id,
          owner,
          msg.profile_id,
          msg.source_id,
          msg.speaker,
          msg.timestamp,
          msg.body,
          msg.start,
          msg.end
        ]);

        await db().prepare(`
          INSERT INTO messages (id, owner, profile_id, source_id, speaker, timestamp, body, start, end)
          VALUES ${placeholders}
        `).bind(...values).run();
      }

      // 4. Automatically index messages for retrieval (Variant B/C support)
      // Fetch the profile we just created
      const profile = await db().prepare('SELECT * FROM profiles WHERE owner=? AND id=?')
        .bind(owner, profileId)
        .first();

      if (profile) {
        try {
          // Index messages in batches until complete
          let indexResult;
          let attempts = 0;
          const MAX_ATTEMPTS = Math.ceil(messages.length / 48) + 5; // 48 messages per batch + buffer

          do {
            indexResult = await indexStep(owner, profile, messages);
            attempts++;

            if (attempts > MAX_ATTEMPTS) {
              console.warn(`[eval-setup] Indexing incomplete after ${attempts} attempts. Indexed ${indexResult.indexed}/${indexResult.total}`);
              break;
            }
          } while (!indexResult.done);

          if (indexResult.done) {
            console.log(`[eval-setup] Indexing complete: ${indexResult.indexed}/${indexResult.total} chunks`);
          }
        } catch (indexError: any) {
          // If indexing fails (e.g., embedding service not running), log but don't block setup
          console.error('[eval-setup] Indexing failed:', indexError.message);
          console.warn('[eval-setup] Setup succeeded but indexing incomplete. Variant B/C may not work.');
        }
      }

      return json({
        success: true,
        profileId,
        sourceId,
        messagesCount: messages.length,
        batches: Math.ceil(messages.length / BATCH_SIZE)
      });
    }

    if (p.action === 'cleanup') {
      // Cleanup evaluation data
      if (!Array.isArray(p.historyIds) || p.historyIds.length === 0) {
        throw new HttpError(400, 'Missing historyIds for cleanup.');
      }

      for (const historyId of p.historyIds) {
        const profileId = `eval-${historyId}`;

        await db().prepare(`DELETE FROM messages WHERE owner=? AND profile_id=?`)
          .bind(owner, profileId)
          .run();

        await db().prepare(`DELETE FROM sources WHERE owner=? AND profile_id=?`)
          .bind(owner, profileId)
          .run();

        await db().prepare(`DELETE FROM profiles WHERE owner=? AND id=?`)
          .bind(owner, profileId)
          .run();

        // Clean related cache
        await db().prepare(`DELETE FROM turns WHERE owner=? AND room LIKE ?`)
          .bind(owner, `%${profileId}%`)
          .run();

        await db().prepare(`DELETE FROM profile_batch_cache WHERE owner=? AND profile_id=?`)
          .bind(owner, profileId)
          .run();
      }

      return json({success: true, cleaned: p.historyIds.length});
    }

    if (p.action === 'clear-cache') {
      // Clear cache for clean evaluation between questions
      await db().prepare(`DELETE FROM retrieval_cache WHERE owner=?`)
        .bind(owner)
        .run();

      await db().prepare(`DELETE FROM turns WHERE owner=?`)
        .bind(owner)
        .run();

      await db().prepare(`DELETE FROM profile_batch_cache WHERE owner=?`)
        .bind(owner)
        .run();

      return json({success: true});
    }

    throw new HttpError(400, 'Unknown action.');

  } catch (e: any) {
    // Enhanced error reporting for debugging
    console.error('[eval-setup] Error:', e);
    console.error('[eval-setup] Stack:', e.stack);

    return json({
      error: e instanceof HttpError ? e.message : 'The request failed safely. Please retry; no answer was verified.',
      details: e.message,
      stack: e.stack?.split('\n').slice(0, 5).join('\n') // First 5 lines of stack
    }, e instanceof HttpError ? e.status : 500);
  }
}
