/**
 * OpenAI shuts down gpt-5, gpt-5-mini, gpt-5-nano, gpt-5-pro, o3 and o3-pro
 * on 2026-12-11 (OpenAI deprecations page, notice of 2026-06-11). After that
 * date a call to any of them fails, so no task may route to one, and the
 * GPT-6 replacements must get the same request shape the GPT-5 family got.
 */
import { describe, expect, it, vi } from 'vitest';

const chatCreate = vi.fn();
vi.mock('openai', () => ({
    OpenAI: class {
        chat = { completions: { create: chatCreate } };
    },
}));

import { TASK_REGISTRY } from '@/lib/ai/tasks';
import { hasPricing } from '@/lib/ai/pricing';
import { openaiProvider } from '@/lib/ai/providers/openai';

const RETIRED = /^(gpt-5|gpt-5-mini|gpt-5-nano|gpt-5-pro|o3|o3-pro)(-\d{4}-\d{2}-\d{2})?$/;

function routedModels(): string[] {
    return Object.values(TASK_REGISTRY).flatMap((t) => [
        t.primary.model,
        ...t.fallbacks.map((f) => f.model),
        ...(t.premium ? [t.premium.model] : []),
    ]);
}

describe('OpenAI model retirement (2026-12-11)', () => {
    it('routes no task to a model OpenAI is shutting down', () => {
        expect(routedModels().filter((m) => RETIRED.test(m))).toEqual([]);
    });

    it('has a price for every routed model', () => {
        expect(routedModels().filter((m) => !hasPricing(m))).toEqual([]);
    });

    it('sends a GPT-6 model max_completion_tokens and no temperature', async () => {
        process.env.OPENAI_API_KEY = 'test-key';
        chatCreate.mockResolvedValue({ choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });

        await openaiProvider.complete({
            model: 'gpt-6-luna',
            messages: [{ role: 'user', content: 'hi' }],
            temperature: 0.1,
            maxTokens: 200,
            jsonMode: true,
        });

        const sent = chatCreate.mock.calls[0][0];
        expect(sent).toMatchObject({ model: 'gpt-6-luna', max_completion_tokens: 200 });
        expect(sent).not.toHaveProperty('max_tokens');
        expect(sent).not.toHaveProperty('temperature');
    });
});
