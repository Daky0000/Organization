# Token Guardian: System Instructions for VS Code Agents

**The complete system for maximizing agent efficiency while minimizing token consumption.**

## What Is Token Guardian?

Token Guardian is a comprehensive skill + system prompt that helps you use VS Code Agents efficiently. It intercepts your prompts, suggests optimizations, and enforces token-saving best practices.

**Bottom line:** Most people waste 50-80% of agent tokens. Token Guardian reduces that waste by teaching you intentional, efficient agent use.

## Quick Start

### 1. Use the System Prompt

Copy the [SKILL.md](./SKILL.md) content into your VS Code agent's system prompt.

### 2. Consult Quick Reference

Pin [quick-reference.md](./references/quick-reference.md) to your monitor. Use it before every agent request.

### 3. Use Prompt Templates

Reference [prompt-templates.md](./references/prompt-templates.md) for pre-built, token-optimized prompts.

### 4. Estimate Tokens

Use `scripts/token_estimator.py` to predict costs before sending:

```bash
python scripts/token_estimator.py --file yourcode.js
python scripts/token_estimator.py --text "Your prompt here"
python scripts/token_estimator.py --compare batch_vs_individual
```

## What's Included

### SKILL.md (Main System Instructions)

The full system prompt with 12 parts:

1. **Core Philosophy** - Token efficiency is about intention, not restriction
2. **Diagnostic Questions** - 5 questions to ask before every prompt
3. **The "Breakdown Before Asking" Framework** - How to plan efficiently
4. **"Relevant Slice" Technique** - Extract only what matters from large files
5. **Context Window Management** - Why conversations get expensive and how to prevent it
6. **Model Selection Strategy** - Use the cheapest capable model
7. **Real-World Patterns & Token Costs** - Specific examples (code review, debugging, refactoring)
8. **System Prompt Optimization** - Custom system prompts for 30-50% token savings
9. **When NOT to Use Agents** - Save the most tokens by not asking at all
10. **Token Guardian Checklist** - Pre-send verification
11. **Troubleshooting High Token Usage** - Diagnose and fix token waste
12. **The Token-Saving Workflow** - 3-step process for every complex task

### References/

**quick-reference.md** - Single-page cheat sheet (print and pin it)
- 30-second token estimation
- Pre-send checklist
- Model selection decision tree
- Real-world scenarios with savings %
- Warning signs of token waste
- Monthly audit template

**prompt-templates.md** - 15+ ready-to-use prompt templates
- Code review (single, batch, focused)
- Debugging (narrow, pattern-based, memory leaks)
- Refactoring (simple, performance, batch)
- Documentation, testing, architecture
- Real-world cost comparisons
- Token-saving pro tips

### Scripts/

**token_estimator.py** - CLI tool for token estimation

```bash
# Estimate tokens in a file
python token_estimator.py --file code.js

# Estimate tokens in text/prompt
python token_estimator.py --text "Your prompt here"

# Estimate conversation cost (15 messages)
python token_estimator.py --conversation 15

# Compare approaches
python token_estimator.py --compare batch_vs_individual

# Calculate model costs
python token_estimator.py --model-cost 500 400 --model sonnet
```

## Key Principles

### 1. The 5 Diagnostic Questions

Before ANY prompt, ask yourself:

- [ ] Is this query actually necessary?
- [ ] What's the token cost vs. benefit?
- [ ] Am I providing necessary context only?
- [ ] Is this the cheapest capable model?
- [ ] Can I batch this with other requests?

**If you answer NO to 2+ questions, redesign your prompt.**

### 2. The "Breakdown Before Asking" Framework

**Stop. Write down (in 2-3 sentences):**

1. What exactly do I need?
2. What are the constraints?
3. What's out of scope?
4. What's the minimal code needed?
5. What format should the response be?

**This 5-minute exercise prevents 5+ token-wasting follow-ups.**

### 3. The "Relevant Slice" Technique

**Don't:**
```
"Look at my entire src/ directory (5,000 lines, 12,500 tokens)"
```

**Do:**
```
"Fix the getUserById function (lines 45-65, 50 tokens) from userService.js"
```

**Savings: 99%**

### 4. Context Window Management

Conversations grow expensive:
- Message 1: 500 tokens
- After 5 exchanges: 5,200 tokens
- After 10 exchanges: ~15,000 tokens (each new message costs more!)

**Rule: Start a new conversation every 15-20 messages**

### 5. Model Ladder

```
Can Haiku solve it?
  ├─ YES → Use Haiku (90% of tasks)
  └─ NO  → Can Sonnet solve it?
           ├─ YES → Use Sonnet (9% of tasks)
           └─ NO  → Use Opus (1% of tasks)
```

**Honestly: Haiku works for 90% of code tasks.**

## Real-World Examples

### Example 1: Code Review (5 Functions)

**❌ Wasteful: 5,000 tokens**
- Send all 250 lines at once
- Ask general review
- Get rambling analysis

**✅ Efficient: 1,200 tokens**
- Break into 2 conversations
- Batch: "Review 3 functions. JSON format."
- Use Haiku
- **Savings: 76%**

### Example 2: Bug Debugging

**❌ Wasteful: 8,000 tokens**
- Describe bug vaguely
- Paste 10 files
- Multiple follow-ups

**✅ Efficient: 400 tokens**
1. You narrow down to exact function
2. Paste only that function (30 lines)
3. "Fix this. Code only."
4. **Savings: 95%**

### Example 3: Batch Refactoring (10 Functions)

**❌ Wasteful: 6,000 tokens**
- Ask about each individually
- Context overhead paid 10 times

**✅ Efficient: 2,000 tokens**
- Send all 10 in one message
- "Refactor all 10."
- **Savings: 67%**

## Expected Results

After implementing Token Guardian:

✓ 50-80% reduction in tokens per task
✓ Faster task completion (better prompts)
✓ Higher first-attempt success rate
✓ Most tasks use <2,000 tokens
✓ 90% of tasks use Haiku

## Implementation Roadmap

### Week 1: Learn the Basics

- [ ] Read SKILL.md (30 minutes)
- [ ] Pin quick-reference.md to monitor
- [ ] Practice one template from prompt-templates.md

### Week 2: Change Habits

- [ ] Use pre-send checklist on every prompt
- [ ] Start fresh conversations at 15 messages
- [ ] Use "Relevant Slice" for large files

### Week 3: Advanced Techniques

- [ ] Create custom system prompts for recurring tasks
- [ ] Batch similar tasks together
- [ ] Use token_estimator.py before complex prompts

### Week 4: Measure & Iterate

- [ ] Track tokens per task
- [ ] Audit last 10 prompts
- [ ] Identify personal patterns of waste

## Common Mistakes to Avoid

| Mistake | Cost | Fix |
|---------|------|-----|
| Letting conversations grow to 30+ messages | +5,000 tokens | Start fresh at 15-20 |
| Sending entire files unfiltered | +8,000 tokens | Use "Relevant Slice" |
| Asking for verbose explanations | +3,000 tokens | Specify format constraint |
| Using Opus for simple tasks | 10x cost | Use decision tree |
| Asking 5 questions in 5 messages | +4,000 tokens | Batch into 1 message |
| Not specifying response format | +2,000 tokens | Use templates |

## Token Cost Reference

### Quick Estimation

```
100 characters    → 30 tokens
500 characters    → 150 tokens
1,000 characters  → 300 tokens
5,000 characters  → 1,500 tokens
10,000 characters → 3,000 tokens
```

### Common Tasks

| Task | Tokens | Model | Time |
|------|--------|-------|------|
| Review 1 function (50 lines) | 300 | Haiku | 2 min |
| Fix bug (30 lines) | 250 | Haiku | 3 min |
| Refactor (50 lines) | 400 | Haiku | 5 min |
| Debug issue (100 lines) | 500 | Sonnet | 5 min |
| Batch review 5 functions | 1,200 | Haiku | 8 min |
| Design review | 800 | Sonnet | 15 min |

### Model Cost Comparison

For 500-token input + 400-token output:

| Model | Cost | vs. Haiku |
|-------|------|-----------|
| Haiku | 1,200 units | 1x |
| Sonnet | 7,950 units | 6.6x |
| Opus | 37,500 units | 31x |

## Troubleshooting

### "My prompts still use 5K+ tokens"

**Diagnosis:**
- Are you copying entire files?
- Are you being verbose?

**Fix:**
1. Use "Relevant Slice" (Part 3 of SKILL.md)
2. Rephrase to be specific (Part 2)
3. Check: File size in lines?

### "Conversations cost 20K+ tokens"

**Diagnosis:**
- Are you beyond 20 messages?
- Carrying conversation history?

**Fix:**
1. Start fresh conversation
2. Use "Memory Note" technique (Part 4, Solution 3)
3. Check: Message count?

### "Responses are 2-3K tokens"

**Diagnosis:**
- Did you ask for explanation?
- Ask the agent to explore options?

**Fix:**
1. Add constraint: "≤300 tokens"
2. Specify format: "JSON only"
3. Update system prompt (Part 8)

## Tools & Resources

### Token Estimator

```bash
# Estimate file
python scripts/token_estimator.py --file code.js

# Estimate prompt
python scripts/token_estimator.py --text "Your prompt"

# Compare approaches
python scripts/token_estimator.py --compare batch_vs_individual

# Calculate model costs
python scripts/token_estimator.py --model-cost 500 400 --model sonnet
```

### Templates

Copy from `references/prompt-templates.md`:
- Code review templates
- Debugging templates
- Refactoring templates
- Documentation templates
- Testing templates
- Architecture templates

### Quick Reference

Print and pin `references/quick-reference.md`:
- Pre-send checklist
- Model selection tree
- Real-world scenarios
- Warning signs
- Monthly audit

## Measuring Success

Track these weekly:

```
✓ Average tokens per task:        < 2,000
✓ Conversations per task:          1-2
✓ Time per task:                   5-15 min
✓ First-attempt success rate:      > 80%
✓ Model distribution:              Haiku 90%, Sonnet 9%, Opus 1%
✓ Tokens per week:                 30% reduction trend
```

## The Golden Rule

> **"Would I solve this faster myself than explaining it to an agent?"**
>
> If YES → Don't ask the agent. This saves the most tokens.
>
> If NO → Ask, but optimize for tokens first.

## FAQ

**Q: Won't token efficiency make my agent use worse?**

A: No. Better prompts get better results. Token efficiency is about removing waste, not removing utility.

**Q: How long until I see results?**

A: Week 1-2: You'll notice yourself catching wasteful patterns.
Week 3-4: You'll have 50%+ token reduction measurable.

**Q: Should I use Token Guardian for everything?**

A: Mostly yes, but especially for:
- Code review tasks
- Debugging multi-file issues
- Large refactoring projects
- Documentation generation

**Q: What if I get stuck?**

A: Read Part 11 ("Troubleshooting") in SKILL.md, or ask yourself: "Am I violating the 5 Diagnostic Questions?"

**Q: Can I customize this for my workflow?**

A: Absolutely. SKILL.md and templates are starting points. Adjust for your patterns.

## License

Token Guardian is provided as-is for use with VS Code Agents.

## Summary

Token Guardian gives you:

✓ System instructions for efficient agent use (SKILL.md)
✓ Quick reference checklist (quick-reference.md)
✓ 15+ ready-to-use prompt templates (prompt-templates.md)
✓ Token estimation tool (token_estimator.py)
✓ Real-world examples and measurement guidance

**Start with SKILL.md. Pin quick-reference.md. Use templates. Measure weekly. You'll save 50-80% of tokens while actually getting better results.**

---

**Questions? Refer to SKILL.md Part X for the specific topic.**

- Understanding tokens? → Part 1
- Writing prompts? → Part 2
- Context management? → Part 4
- Model selection? → Part 5
- Real examples? → Part 6
- System prompts? → Part 8
- When NOT to ask? → Part 9
- Pre-send checklist? → Part 10
- Troubleshooting? → Part 11
- Measuring? → Part 12
