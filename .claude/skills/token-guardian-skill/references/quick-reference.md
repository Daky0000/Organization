# Token Guardian: Quick Reference Card

**Print this. Pin it. Use it.**

---

## 30-Second Token Estimation

```
Characters ÷ 4 ≈ Tokens

100 chars   → 25 tokens      (~0.5 sec to read)
500 chars   → 125 tokens     (~2 sec to read)
1,000 chars → 250 tokens     (~5 sec to read)
10,000 chars → 2,500 tokens  (~50 sec to read)
```

---

## Pre-Send Checklist (Do This Every Time)

```
☐ Is this actually necessary?
☐ Can I solve it myself faster?
☐ Have I narrowed to specific problem?
☐ Am I including ONLY relevant code?
☐ Have I specified format + length?
☐ Am I using cheapest capable model?
☐ Can I batch with other requests?
☐ Is this conversation < 20 messages?

✓ 6+ boxes checked = Send
✗ <6 boxes checked = Redesign first
```

---

## Model Selection Decision Tree

```
Can Haiku solve it?
  ├─ YES → Use Haiku (cheapest, 90% of tasks)
  └─ NO  → Can Sonnet solve it?
           ├─ YES → Use Sonnet (best value)
           └─ NO  → Use Opus (true blockers only)
```

**Honest breakdown:**
- Haiku: 90% of code tasks
- Sonnet: 9% of tasks
- Opus: 1% of tasks

---

## Common Token Costs

| Task | Code | Tokens | Model | Time |
|------|------|--------|-------|------|
| Review 1 function | 50 lines | 300 | Haiku | 2min |
| Fix bug | 30 lines | 250 | Haiku | 3min |
| Refactor | 50 lines | 400 | Haiku | 5min |
| Debug issue | 100 lines | 500 | Sonnet | 5min |
| Review 5 functions (batch) | 250 lines | 1,200 | Haiku | 8min |
| Design review | description | 800 | Sonnet | 15min |

---

## Token-Saving Rules (Priority Order)

### 🔴 Critical (50%+ savings each)

1. **Start fresh conversations** (every 15-20 messages)
2. **Use "Relevant Slice" technique** (don't send entire files)
3. **Specify format/length** (eliminates rambling)

### 🟡 Important (20-30% savings each)

4. **Use cheapest model** (Haiku > Sonnet)
5. **Batch related tasks** (1 batch < N individual)
6. **Narrow down problems first** (don't make agent hunt)

### 🟢 Nice-to-Have (5-10% savings each)

7. Summarize before adding context
8. Use custom system prompts
9. Pre-process before sending

---

## Real-World Scenarios

### Scenario 1: Code Review (5 functions)

**❌ Wasteful:**
- Send all 250 lines at once
- Ask general review
- Get 5 reviews in prose
- Cost: 5,000 tokens

**✅ Efficient:**
- Break into 2 conversations
- Batch functions: "Review 3 functions. JSON format."
- Cost: 1,200 tokens
- **Savings: 76%**

### Scenario 2: Bug Debugging

**❌ Wasteful:**
- Describe bug vaguely
- Paste 10 files
- Get lengthy analysis
- Multiple follow-ups
- Cost: 8,000 tokens

**✅ Efficient:**
- You narrow down to exact function
- Paste only that function (30 lines)
- Ask for fix in code-only format
- Cost: 400 tokens
- **Savings: 95%**

### Scenario 3: Refactoring (10 functions)

**❌ Wasteful:**
- Ask about each function individually (10 messages)
- Context overhead paid 10 times
- Cost: 6,000 tokens

**✅ Efficient:**
- Ask for all 10 in one message
- "Refactor all 10. Respond with all 10."
- Cost: 2,000 tokens
- **Savings: 67%**

---

## Format Templates (Copy & Paste)

### Template A: Simple Request

```
[Specific task]. Respond with [format] only.
```

Example:
```
Refactor this function for performance. Respond with code only.
```

### Template B: Complex Request

```
[Context]. [Specific code]. 
Constraints: [list]. 
Respond with: [format], ≤[length].
```

Example:
```
We're optimizing auth. Here's the token validator:
[paste code]
Constraints: backward compatible, use existing db pool.
Respond with: refactored function, inline comments, ≤20 lines.
```

### Template C: System Prompt

```
You are [role]. Respond [format]. [Constraint]. [Length limit].
```

Example:
```
You are a code reviewer. Respond with JSON only. 
Each review: ≤2 sentences. No explanations outside JSON. Include: bugs, improvements, style.
```

---

## Warning Signs (High Token Usage)

| Warning | Fix |
|---------|-----|
| Conversation 30+ messages | Start fresh (use Memory Note) |
| Single prompt >3K tokens | Use "Relevant Slice" |
| Response 2-3K tokens | Add format constraint ("≤500 tokens") |
| Using Opus 10% of time | Audit tasks; most should be Haiku |
| Repeating context in each message | Summarize once instead |

---

## Conversation Length Guide

```
Message count → Action
1-5           → Great! Keep this focus
6-10          → Still good, maintain focus
11-15         → Getting long, consider new conversation
16-20         → Definitely consider fresh start
21+           → Start new conversation immediately
```

**Rule: 15-20 messages = new conversation**

---

## Context Growth Over Time

```
Messages  │  Cumulative Context
──────────┼────────────────────
1         │  500 tokens
2         │  1,300 tokens
3         │  2,500 tokens
4         │  3,700 tokens
5         │  5,200 tokens
──────────┼────────────────────
10        │  ~15,000 tokens (each new message costs more!)
20        │  ~60,000+ tokens
```

**Lesson: Starting a new conversation saves 80%+ tokens**

---

## The "Relevant Slice" Examples

### Code Review

**Instead of:**
```
Review my entire src/ directory (5,000 lines)
```

**Do this:**
```
Review src/components/Button.jsx (100 lines) for performance issues
```

**Savings: 92% (5000 lines → 100 lines)**

### Debugging

**Instead of:**
```
My app crashes. Here's the full error log and my 500 files
```

**Do this:**
```
App crashes with: [error]. Happens when [condition].
Here's the function causing it (30 lines): [code]
```

**Savings: 95%**

### Architecture

**Instead of:**
```
Is our architecture scalable? [describe entire system, 100 lines]
```

**Do this:**
```
Is our database layer (here: [40 lines]) scalable for 1M users?
```

**Savings: 60%**

---

## Monthly Token Audit

Do this quarterly to track improvement:

```
Week 1:
- Total tokens: ________
- Avg tokens per task: ________
- Conversations per task: ________
- Most-used model: ________

Week 2:
- Total tokens: ________
- Avg tokens per task: ________
- Conversations per task: ________
- Most-used model: ________

Target:
✓ 30% token reduction over 4 weeks
✓ Avg <2,000 tokens per task
✓ 1-2 conversations per task
✓ 90% Haiku usage
```

---

## Emergency Optimization

If you're running low on tokens TODAY:

### Immediate (Do Now)
1. ☑ Stop using Opus immediately (Sonnet only)
2. ☑ Start new conversations (clear context)
3. ☑ Extract only relevant slices (no full files)
4. ☑ Use JSON format (no prose)

### Next 24 Hours
5. ☑ Audit last 10 prompts → identify waste
6. ☑ Rewrite 3 prompts using templates above
7. ☑ Measure new token costs

### This Week
8. ☑ Implement 15-20 message limit
9. ☑ Use "Relevant Slice" for everything
10. ☑ Track tokens per task daily

---

## Success Metrics

Check these weekly:

```
✓ Average tokens per task:        < 2,000
✓ Conversations per task:          1-2
✓ Time per task:                   5-15 min
✓ First-attempt success rate:      > 80%
✓ Model distribution:              Haiku 90%, Sonnet 9%, Opus 1%
```

If any metric is off, review this card again.

---

## When to Ask Token Guardian

- "Is this prompt efficient?"
- "Should I batch these?"
- "Is my conversation too long?"
- "Which model should I use?"
- "How can I save tokens on this task?"
- "Am I using relevant slices?"
- "Should I start a fresh conversation?"

**Short answer: Whenever you're about to hit send and wonder if there's a cheaper way.**

---

## Final Rules

```
1. Think before you ask       → 5 min planning = 80% token savings
2. Use cheapest model         → Haiku 90% of the time
3. Include only what matters  → "Relevant Slice" technique
4. Specify format & length    → Eliminates 30% of waste
5. Start fresh frequently     → Every 15-20 messages
6. Batch related tasks        → One batch < N individual prompts
```

**These 6 rules = 50-80% token reduction**

---

## The Golden Rule

> **"Would I solve this faster myself than explaining it to an agent?"**
>
> If YES → Don't ask the agent.
>
> If NO → Ask, but optimize for tokens first.

---

**Remember: Every token saved is a token available for something that matters.**
