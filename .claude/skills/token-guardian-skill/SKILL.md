---
name: token-guardian
description: "Token Guardian helps you use VS Code Agents efficiently by monitoring token consumption, enforcing token-saving best practices, and intercepting queries that waste tokens. Triggers whenever you're about to make an agent request, especially for code review, debugging, refactoring, or file manipulation tasks. Use this skill whenever you notice token counts growing, want to optimize a prompt, are asking multiple related questions, are including large files, or need help breaking down a complex task. This skill will proactively suggest the cheapest approach and help you rephrase queries for maximum efficiency."
compatibility: "VS Code Agents extension (any model)"
---

# Token Guardian: System Instructions for Efficient Agent Use

## Core Philosophy

**Token efficiency is about intention, not restriction.** This skill doesn't prevent you from using agents—it makes you intentional about *when* and *how* you use them. Every token saved is a token available for something that actually matters.

---

## How This Skill Works

Token Guardian operates in three modes:

1. **Preventive Mode**: Intercepts your prompt before you send it and suggests optimizations
2. **Coaching Mode**: Explains why a certain approach wastes tokens and what to do instead
3. **Planning Mode**: Helps you break down complex tasks into token-efficient sequences

---

## Part 1: Diagnostic Questions

Before you send any request to an agent, ask yourself these questions. Token Guardian will help you answer them:

### 1. **Is this query actually necessary?**
   - Can you solve this yourself faster than explaining it?
   - Have you already asked a very similar question recently?
   - Is this just asking for confirmation?

   **Action**: If you answered YES to any, STOP. Don't send the query.

### 2. **What's the token cost vs. benefit?**
   - Estimate the query size: ~0.00025 tokens per character
   - Estimate response size: typically 2-5x the query for code
   - Ask yourself: "Is the answer worth X tokens?"

   **Example**: A 500-line file ≈ 1,250 tokens to send. A 100-token response might not be worth it.
   
   **Action**: If cost > benefit, break it down (see Part 2).

### 3. **Am I providing necessary context only?**
   - Are you copying entire files when only functions matter?
   - Are you including your full project structure?
   - Are you pasting conversation history instead of summarizing?

   **Action**: Extract only what's needed (see Part 3).

### 4. **Is this the cheapest capable model?**
   - Haiku is 10x cheaper than Opus for simple tasks
   - Sonnet is the value sweet-spot for most work
   - Opus is only for blockers

   **Action**: Start with Haiku or Sonnet. Upgrade only if stuck.

### 5. **Can I batch this with other requests?**
   - Can I ask 5 questions in one message instead of 5 messages?
   - Can I review multiple code samples simultaneously?
   - Can I handle multiple files in one request?

   **Action**: If batching saves >20% tokens, do it.

---

## Part 2: The "Breakdown Before Asking" Framework

When you feel the urge to send a large or complex query, STOP and break it down:

### Step 1: Define the Core Need (in writing)
Write 2-3 sentences about what you actually need. Not what you'll explain to the agent—what you need.

```
Example: "I need to refactor the auth.js file's token validation function 
to be more efficient. Currently it validates every token against the database 
on each request, which is slow."
```

### Step 2: Identify Constraints
What are the absolute requirements? What's out of scope?

```
Requirements:
- Must maintain backward compatibility
- Must use the existing database connection pool
- Must add logging

Out of scope:
- Switching to Redis
- Changing the authentication strategy
- Rewriting the entire auth system
```

### Step 3: Narrow the Input
What's the minimal code needed to solve this?

```
Instead of: Send entire auth.js (500 lines)
Send only: The token validation function (20 lines) + usage examples (10 lines)
```

### Step 4: Specify the Format
What format should the response be?

```
Response format:
- Refactored function only (no explanation)
- Include inline comments explaining changes
- Keep under 25 lines
```

### Step 5: Create the Final Prompt
Use all the above to write a tight, specific prompt:

```
GOOD PROMPT (200 tokens):
"Refactor the tokenValidate function below for O(1) performance:
[paste function]
Constraints: backward compatible, use existing db pool, add logging.
Respond with: function code only, inline comments, ≤25 lines."

BAD PROMPT (1200 tokens):
"I have this authentication system that's been bugging me. The token validation 
is slow and I've been trying to figure out what the issue is. I think it might 
be hitting the database too much. Can you look at my whole auth system and see 
what you think? Here's my entire auth.js file [paste 500 lines]. I need it to 
be faster and also I want to make sure it still works with our old API. Can you 
also add logging? Let me know what you think."
```

---

## Part 3: The "Relevant Slice" Technique

Large files are token killers. Use this technique to extract only what matters:

### For Code Files:

1. **Identify the problem area** (don't ask the agent to find it)
   - Where does the error occur?
   - Which function is slow?
   - What line changed?

2. **Extract only that section**
   ```
   # INSTEAD OF
   "Here's my entire service/ directory (5000 lines, ~12,500 tokens)"
   
   # DO THIS
   "Here's the getUserById function from userService.js (lines 45-60):"
   [paste only those lines]
   ```

3. **Include minimal context**
   - Type definitions needed
   - One example of the function being called
   - Error message or current behavior

4. **Ask for the specific fix**
   ```
   "This function causes N+1 queries. Replace the query loop 
   with a batch query using knex.whereIn(). Respond with only 
   the new function (≤10 lines)."
   ```

### For Large Projects:

1. **Provide a map instead of everything**
   ```
   /**
    * Project Structure (abridged):
    * src/
    *   ├── api/          ← We're focusing here
    *   │   ├── routes.js (200 lines)
    *   │   └── handlers.js (150 lines) ← SPECIFIC FILE
    *   └── db/           (not relevant)
    *
    * The problem is in handlers.js, getUserHandler function (lines 45-65).
    */
   ```

2. **Only include the relevant file/function**
   ```
   "In src/api/handlers.js (lines 45-65), this function 
   has a memory leak. Fix it:"
   [paste lines 45-65]
   ```

3. **Ask the agent to reference the map**
   ```
   "Given the project structure above, how would you refactor 
   the getUserHandler to reduce memory? Explain in 2-3 sentences."
   ```

---

## Part 4: Context Window Management

### The Context Growth Problem

In a single conversation, every message and response stays in context:

```
Conversation length → Cumulative context size
Message 1:     500 tokens   → Total: 500
Response 1:    800 tokens   → Total: 1,300
Message 2:     600 tokens   → Total: 2,500
Response 2:    1,200 tokens → Total: 3,700
...
After 10 exchanges: ~20,000 tokens just for history
```

Each new question in the same conversation costs 20K+ input tokens just to carry history.

### Solution 1: Start Fresh Conversations

When to start a new conversation:
- After 15-20 messages
- When switching tasks (code review → debugging → refactoring)
- When the conversation feels confused or off-track
- When total context exceeds 50K tokens

**Token savings: 60-80% reduction** (avoid carrying large history)

### Solution 2: Summarize Before Adding Context

Instead of including entire conversation history:

```
❌ EXPENSIVE (carries all history):
[Include entire 40K-token conversation]
"Now, also help me refactor the error handler"

✅ EFFICIENT (20 tokens):
"Earlier, we fixed the token validation function to use batch queries.
Now, help me refactor the error handler to follow the same pattern:"
[paste error handler]
```

### Solution 3: The "Memory Note" Technique

Before starting a new conversation, ask the agent to create a brief summary:

```
OLD CONVERSATION:
Agent: [provides solution]
You: "Summarize your previous advice in ≤150 words, focusing on the
      pattern and key decisions."
Agent: "We optimized... by using... The key pattern is..."

NEW CONVERSATION:
"Previously, you optimized with this pattern: [paste summary].
Now apply the same pattern to [new file]."
```

**Token savings: ~500 tokens per summarization** (worth it if you have 5+ follow-ups)

---

## Part 5: Model Selection Strategy

### The Model Ladder

Use this decision tree:

```
Can Haiku solve it? (simple fixes, refactoring, formatting)
  → YES: Use Haiku (cheapest)
  → NO: Can Sonnet solve it? (complex logic, debugging, architecture)
    → YES: Use Sonnet (best value)
    → NO: Use Opus (only for true blockers)
```

### Token Cost Multipliers

|Task|Haiku|Sonnet|Opus|Choose|
|---|---|---|---|---|
|Simple refactor|1x|2.5x|5x|Haiku|
|Bug fix|1x|2x|4x|Haiku or Sonnet|
|Architecture|1x|3x|6x|Sonnet|
|Research/Analysis|1x|2.5x|5x|Sonnet|
|Complex system design|1x|4x|8x|Opus|

### The "Escalation Rule"

Start with Haiku. Only escalate if:
1. Haiku produces obviously wrong code
2. Haiku says "I can't handle this complexity"
3. You've tried Haiku twice and failed

---

## Part 6: Real-World Patterns & Token Costs

### Pattern 1: Code Review (5 functions, ~250 lines)

**WASTEFUL APPROACH** (~5,000 tokens):
- Send all 250 lines at once
- Agent reviews all 5 functions
- You only needed 1 reviewed

**EFFICIENT APPROACH** (~1,200 tokens):
- Break into 3 new conversations
- Review 2 functions per conversation
- Ask: "Review for bugs, performance, style. Respond in JSON format only."
- Use Haiku

**Savings: ~75%**

### Pattern 2: Iterative Debugging

**WASTEFUL** (~8,000 tokens):
```
You: "Debug this error" [full stack trace + 300 lines of code]
Agent: [response]
You: "Still not working, here's the error log" [full logs]
Agent: [response]
You: "Let me add more context" [more files]
Agent: [response]
```
Total: 8K tokens, 3 conversations wasted

**EFFICIENT** (~2,000 tokens):
```
You: Manually narrow down to the exact function causing the issue
     Send only: the problematic function + error message
     "Fix this. Respond with only the fixed function."
Agent: [fixed function]
Test locally. If still broken, start new conversation with updated code.
```

**Savings: ~75%**

### Pattern 3: Batch Refactoring (10 similar functions)

**WASTEFUL** (~6,000 tokens):
- Ask for each function individually
- Context overhead paid 10 times

**EFFICIENT** (~2,000 tokens):
- Send all 10 functions in one message
- "Refactor all 10 for clarity. Respond with all 10 functions."
- Copy result back into editor

**Savings: ~67%**

---

## Part 7: System Prompt Optimization

When you're using agents repeatedly for the same task, customize the system prompt:

### Example: Python Code Review

```
SYSTEM PROMPT:
"You are a Python code reviewer. 
Output ONLY JSON with keys: bugs, performance, style, security.
Keep suggestions ≤2 sentences each.
Ignore docstrings and comments.
Never include explanations outside the JSON."

This system prompt:
- Eliminates prose explanations (saves ~30% tokens)
- Forces structured output (easier to parse)
- Focuses the agent on essentials (less rambling)
```

### Example: Quick Bug Fixes

```
SYSTEM PROMPT:
"You fix bugs in JavaScript code.
Respond ONLY with fixed code.
No explanations, no markdown, no comments.
Keep fixes ≤5 lines.
Preserve original code style."

Savings: ~40% token reduction vs. normal verbose responses
```

---

## Part 8: When NOT to Use Agents (Save All Tokens)

Before asking an agent anything, check this list:

- ✓ **Can I Google it?** (Stack Overflow answers, documentation) → Don't ask agent
- ✓ **Can I read the error message?** (Most errors are self-explanatory) → Don't ask agent
- ✓ **Can I test it locally first?** (IDE autocomplete, linting) → Don't ask agent
- ✓ **Is this just copy-paste?** (Finding an example online) → Don't ask agent
- ✓ **Am I asking for confirmation?** ("Does this look right?") → Don't ask agent (unless truly uncertain)

**These save the most tokens: not asking.**

---

## Part 9: Token Guardian Checklist

Before sending ANY request, work through this checklist:

### Pre-Send Checklist (60 seconds)

```
☐ Have I tried solving this myself first?
☐ Can I narrow this to a specific problem?
☐ Am I including only relevant code/files?
☐ Have I specified: format, length, constraints?
☐ Is this the cheapest capable model?
☐ Can I batch this with other requests?
☐ Does this conversation already have 20+ messages? (Start fresh?)
☐ Is the benefit worth the token cost?

If you checked < 6 boxes, STOP and redesign your prompt.
```

### Token Cost Estimation (Quick Version)

```
Characters ÷ 4 ≈ Tokens

Examples:
- 100-char message     → ~25 tokens
- 500-line code file   → ~1,250 tokens
- Brief function       → ~150 tokens
- This entire skill    → ~7,000 tokens
```

---

## Part 10: Troubleshooting High Token Usage

### Symptom: Conversations cost 20K+ tokens for simple tasks

**Diagnosis:**
- Is your conversation 30+ messages long?
- Are you repeating context in each message?
- Are you including large files repeatedly?

**Treatment:**
1. **Immediate**: Start a new conversation. Use the "Memory Note" (Part 4, Solution 3).
2. **Preventive**: Check message count. Start fresh at 15-20 messages.

### Symptom: Single prompt costs 5K+ tokens

**Diagnosis:**
- Are you copying entire files/projects?
- Are you including full conversations?
- Are you being verbose in your prompt?

**Treatment:**
1. Use the "Relevant Slice" technique (Part 3)
2. Rephrase the prompt to be specific (Part 2, Step 5)
3. Use Haiku instead of Sonnet/Opus

### Symptom: Responses are 2-3K tokens when you expected 200

**Diagnosis:**
- Did you ask for explanation/reasoning?
- Did you ask the agent to explore options?
- Did you ask for verbose feedback?

**Treatment:**
1. Update system prompt to include: "Keep responses brief and concise."
2. Ask for format constraints: "Respond in ≤300 tokens."
3. Ask for specific format: "JSON only" or "Code only"

---

## Part 11: The Token-Saving Workflow

Use this 3-step workflow for every complex task:

### Step 1: Plan (5 minutes, 0 tokens)

Write down:
- What exactly do I need?
- What are the constraints?
- What's out of scope?
- What's the minimal input?
- What format should the output be?

### Step 2: Break Down (5 minutes, 0 tokens)

If the task is complex:
- Can I split it into 2-3 independent subtasks?
- Should I do this in multiple conversations?
- What's the dependency order?

### Step 3: Execute (5-10 minutes per subtask)

For each subtask:
- Use the cheapest capable model
- Apply "Relevant Slice" (Part 3)
- Use "Breakdown Before Asking" (Part 2)
- Start a fresh conversation
- Send one focused message

**Total token cost: 60-80% less than unplanned approach**

---

## Part 12: Measuring Improvement

Track these metrics over time:

### Key Metrics

1. **Tokens per task** (should decrease)
   - Track the average tokens spent per completed task
   - Target: 30% reduction over 2 weeks

2. **Conversations per task** (should stay low or decrease)
   - Ideal: 1-2 focused conversations
   - Avoid: 10+ conversations per task

3. **First-attempt success rate** (should increase)
   - How often does the agent's first response work?
   - Better prompts = higher success rate = fewer retries

4. **Time per task** (may decrease as you plan better)
   - Better planning = faster execution
   - Include planning time in measurement

### Sanity Checks

```
Good sign:
✓ Most tasks use <2,000 tokens
✓ Conversations are 3-7 messages
✓ Model is Haiku or Sonnet 90% of the time
✓ Planning time = 10% of execution time

Warning signs:
✗ Most tasks use >5,000 tokens
✗ Conversations average 20+ messages
✗ Using Opus for simple tasks
✗ Sending huge files unfiltered
```

---

## Quick Reference: Token-Saving Rules

|Rule|Impact|Difficulty|
|---|---|---|
|Start fresh conversations (15-20 msg limit)|⭐⭐⭐⭐⭐|Easy|
|Include only relevant files/slices|⭐⭐⭐⭐|Easy|
|Use specific, constrained prompts|⭐⭐⭐⭐|Medium|
|Batch related tasks together|⭐⭐⭐|Medium|
|Use cheapest capable model|⭐⭐⭐|Easy|
|Specify format/length constraints|⭐⭐|Easy|
|Summarize before adding context|⭐⭐⭐|Medium|
|Narrow down bugs yourself first|⭐⭐⭐⭐|Medium|
|Use "Relevant Slice" technique|⭐⭐⭐⭐|Medium|
|Break down before asking|⭐⭐⭐|Medium|

---

## When to Consult Token Guardian

Ask yourself these questions:
- "Am I about to send a large prompt?" → **Consult Token Guardian**
- "Is my conversation getting long?" → **Consult Token Guardian**
- "Should I use Opus or Sonnet?" → **Consult Token Guardian**
- "Is there a cheaper way to do this?" → **Consult Token Guardian**
- "How do I refactor my prompt?" → **Consult Token Guardian**

Token Guardian is your voice of reason for token efficiency. When in doubt, ask.

---

## Summary

Token efficiency is not about restriction—it's about **intentionality**. Every token saved is a token available for something that matters. Follow these principles:

1. **Think before you ask** - 5-minute planning saves 80% of tokens
2. **Extract only what matters** - Use "Relevant Slice" for large files
3. **Start fresh frequently** - 15-20 message limit per conversation
4. **Use the cheapest model** - Haiku for 90% of tasks
5. **Specify format & constraints** - Save 30-50% on response tokens
6. **Measure and iterate** - Track tokens per task and improve

**Expected results: 50-80% token reduction while actually getting better, faster results.**
