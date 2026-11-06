# Token Guardian: Prompt Templates & Examples

This reference contains ready-to-use prompt templates optimized for token efficiency.

## Table of Contents

1. Code Review Templates
2. Debugging Templates
3. Refactoring Templates
4. Documentation Templates
5. Testing Templates
6. Architecture Templates

---

## 1. Code Review Templates

### Template 1.1: Single Function Review (Fast)

**Cost: ~300 input + 200 output tokens | Model: Haiku | Time: 2 min**

```
[System Prompt]
"You are a code reviewer. Output ONLY JSON with keys: bugs, improvements, style.
Each item: ≤2 sentences. No explanations outside JSON."

[User Message]
"Review this function for bugs, performance, and style:

[PASTE FUNCTION 20-40 LINES]

Respond ONLY as JSON."
```

**Why efficient:**
- ✓ Specific format eliminates prose
- ✓ Single function keeps input small
- ✓ Haiku handles this perfectly
- ✓ JSON output is parseable

---

### Template 1.2: Multiple Functions Batch Review

**Cost: ~800 input + 500 output tokens | Model: Haiku | Time: 10 min**

```
[System Prompt]
"You are a code reviewer. Output ONLY a JSON array with keys: 
function, bugs, improvements, style.
Each item: ≤2 sentences."

[User Message]
"Review these 5 functions. Respond only as JSON array:

FUNCTION 1:
[PASTE 20 LINES]

FUNCTION 2:
[PASTE 20 LINES]

...

Respond as JSON array only."
```

**Why efficient:**
- ✓ Batching saves context overhead
- ✓ Structured output == consistent parsing
- ✓ 5 functions in one prompt = 5x cheaper than individual reviews

**Result comparison:**
- Individual reviews: 5 × (~300 + 200) = 2,500 tokens
- Batch review: 1 × (~800 + 500) = 1,300 tokens
- **Savings: 48%**

---

### Template 1.3: Code Review with Specific Focus

**Cost: ~350 input + 250 output tokens | Model: Haiku | Time: 5 min**

```
[User Message]
"Review ONLY for performance issues in this function:

[PASTE FUNCTION]

Constraints:
- Database calls should be <3 per execution
- No N+1 queries
- No nested loops with lists >100 items

Respond with: 'No issues' OR list exact line numbers and fixes."
```

**Why efficient:**
- ✓ Specific focus reduces scope
- ✓ Constraints prevent rambling
- ✓ Clear format expectation

---

## 2. Debugging Templates

### Template 2.1: Narrow Debugging (One Function)

**Cost: ~250 input + 200 output tokens | Model: Haiku | Time: 3 min**

```
[User Message]
"This function throws 'TypeError: cannot read property of undefined' 
at line 45:

[PASTE BUGGY FUNCTION: 15-25 LINES]

Error occurs when: [describe specific condition]

Fix it. Respond with only the corrected function."
```

**Why efficient:**
- ✓ You narrowed it down (didn't make agent hunt)
- ✓ You provided error context
- ✓ You specified response format
- ✓ Small focused function

---

### Template 2.2: Error Pattern Debugging

**Cost: ~400 input + 300 output tokens | Model: Sonnet | Time: 5 min**

```
[User Message]
"I'm getting this error repeatedly:
[PASTE ERROR MESSAGE - 5 LINES]

Context:
- Happens after user clicks 'Save'
- Happens 30% of the time (intermittent)
- No errors in console before this

Here's the save handler:
[PASTE SAVE HANDLER - 30 LINES]

What's the root cause? Respond in 2-3 sentences, then provide the fix."
```

**Why efficient:**
- ✓ You provided error + context (agent doesn't have to hunt)
- ✓ Intermittent nature is specified
- ✓ Focused file provided
- ✓ Response format is constrained

---

### Template 2.3: Memory Leak Debugging

**Cost: ~500 input + 400 output tokens | Model: Sonnet | Time: 8 min**

```
[System Prompt]
"You are debugging a memory leak. Output only: 'likely cause', 'fix', 'test steps'.
Each section: ≤2 sentences. No explanation."

[User Message]
"Memory usage grows from 100MB to 1GB over 2 hours in production.
Heap snapshot shows 50K+ instances of [Object] in memory.

Here's the main event listener:
[PASTE LISTENER CODE - 40 LINES]

Debugging info:
- Listener attaches on page load
- Listeners removed with: [describe removal]
- Event fires ~100x/min in high-traffic scenarios"
```

**Why efficient:**
- ✓ You provided heap snapshot analysis
- ✓ Specific event listener provided
- ✓ Context about frequency
- ✓ Structured output format

---

## 3. Refactoring Templates

### Template 3.1: Simple Refactor

**Cost: ~300 input + 150 output tokens | Model: Haiku | Time: 3 min**

```
[User Message]
"Refactor for clarity (ES6+):

[PASTE 20-30 LINES]

Goal: reduce nested callbacks, use async/await.
Respond with refactored code only."
```

**Why efficient:**
- ✓ Small, focused code slice
- ✓ Clear goal
- ✓ Specific format

---

### Template 3.2: Performance Refactor

**Cost: ~400 input + 300 output tokens | Model: Sonnet | Time: 5 min**

```
[User Message]
"This query is slow (takes 3 seconds for 1K items):

[PASTE QUERY - 20 LINES]

Current result size: 1,000 items
Current query time: 3 seconds
Target: <200ms for 1,000 items

Constraints:
- Can't change database schema
- Must return same data structure
- Must use existing connection pool

Respond with:
1. Performance analysis (1-2 sentences)
2. Refactored query
3. Expected improvement (%)"
```

**Why efficient:**
- ✓ You provided metrics (3 seconds, 1K items)
- ✓ You specified constraints (no schema changes)
- ✓ Clear response format

---

### Template 3.3: Batch Refactoring (Multiple Similar Functions)

**Cost: ~700 input + 500 output tokens | Model: Haiku | Time: 8 min**

```
[User Message]
"Refactor these 3 functions for consistency:

FUNCTION A:
[PASTE 15 LINES]

FUNCTION B:
[PASTE 15 LINES]

FUNCTION C:
[PASTE 15 LINES]

Pattern to apply: [describe pattern]
Respond with all 3 refactored functions."
```

**Why efficient:**
- ✓ Batching saves 60% vs. asking individually
- ✓ Consistency pattern is specified
- ✓ Grouped in one conversation

---

## 4. Documentation Templates

### Template 4.1: Add JSDoc Comments

**Cost: ~300 input + 200 output tokens | Model: Haiku | Time: 3 min**

```
[User Message]
"Add JSDoc comments to this function:

[PASTE FUNCTION - 25 LINES]

Respond with function + JSDoc only."
```

**Why efficient:**
- ✓ Task is very focused
- ✓ Haiku handles this easily
- ✓ Short response expected

---

### Template 4.2: Generate README for Module

**Cost: ~500 input + 800 output tokens | Model: Sonnet | Time: 10 min**

```
[User Message]
"Generate a README for this module.

Module overview:
[DESCRIBE IN 2-3 SENTENCES]

Key files:
- auth.js - handles authentication
- validate.js - validates tokens
- errors.js - error types

Here's the main export:
[PASTE MAIN EXPORT - 40 LINES]

Generate README with sections:
1. Overview (2 sentences)
2. Installation (bullet list)
3. Usage (1 example)
4. API (method signatures only)
5. Error handling (bullet list)

Keep total length <500 words."
```

**Why efficient:**
- ✓ Clear sections specified
- ✓ Word limit prevents verbosity
- ✓ You provided structure

---

## 5. Testing Templates

### Template 5.1: Write Unit Tests

**Cost: ~400 input + 500 output tokens | Model: Haiku | Time: 8 min**

```
[System Prompt]
"You write Jest tests. Output ONLY test code, no explanations."

[User Message]
"Write tests for this function:

[PASTE FUNCTION - 20 LINES]

Test cases:
1. Valid input → returns expected output
2. Empty input → throws error
3. Invalid type → throws error
4. Edge case: input with 0 items

Format: Jest syntax, 4-5 assertions per test."
```

**Why efficient:**
- ✓ Function is small and specific
- ✓ Test cases are listed (agent doesn't hunt)
- ✓ Format and assertion count specified

---

### Template 5.2: Generate Integration Test

**Cost: ~600 input + 700 output tokens | Model: Sonnet | Time: 12 min**

```
[User Message]
"Write an integration test for this user flow:

1. User submits login form
2. System validates credentials
3. System returns JWT token
4. Client stores token in localStorage
5. Client redirects to dashboard

Code to test:
[PASTE AUTH HANDLER - 40 LINES]
[PASTE LOGIN ENDPOINT - 20 LINES]
[PASTE TOKEN VALIDATION - 30 LINES]

Dependencies:
- Testing framework: Jest
- HTTP mock: nock
- Database mock: in-memory SQLite

Write test. Include: setup, assertions, cleanup."
```

**Why efficient:**
- ✓ Flow is clearly described
- ✓ All related code in one message
- ✓ Dependencies are specified

---

## 6. Architecture Templates

### Template 6.1: Design Review

**Cost: ~800 input + 600 output tokens | Model: Sonnet | Time: 15 min**

```
[User Message]
"Review this architecture for scalability issues:

Current system:
- Single Node.js server
- PostgreSQL database
- Redis cache
- 1,000 concurrent users expected
- 10GB data

Here's the main flow:
[PASTE ARCHITECTURE DIAGRAM OR DESCRIPTION - 40 LINES]

Bottlenecks I know about:
- Auth checks hit database every request
- Session storage in Redis not distributed

Potential issues:
- Database connection pool (currently 20)
- Memory on single server

Respond with:
1. Top 3 scalability issues
2. Priority (high/medium/low)
3. Quick fix for each (1-2 sentences)"
```

**Why efficient:**
- ✓ You identified known issues (prevents tangents)
- ✓ Context is provided (user count, data size)
- ✓ Specific response format

---

### Template 6.2: Technology Choice

**Cost: ~500 input + 400 output tokens | Model: Sonnet | Time: 10 min**

```
[User Message]
"Should we use [Option A] or [Option B]?

Context:
- Team: 3 developers
- Timeline: 6 months
- Scale: starting at 100K users, scaling to 1M
- Current stack: JavaScript/Node.js

Option A: [Description with pros/cons]
Option B: [Description with pros/cons]

Constraints:
- Must be maintainable by small team
- Can't take 2+ months to learn

Respond with:
1. Recommendation (A or B)
2. Why (3 points)
3. Risks for other option"
```

**Why efficient:**
- ✓ Context is clear
- ✓ Both options are specified
- ✓ Constraints are listed
- ✓ Response format is structured

---

## Real-World Cost Comparison

### Scenario: Refactor 5 Functions

#### ❌ INEFFICIENT APPROACH

```
Message 1: "Can you look at these 5 functions in my auth.js file?
            Here's the whole file:" [paste 500 lines]
            (~1,200 input tokens)
            Response: [rambling analysis] (~1,500 output tokens)
            
Message 2: "OK, let's start with the first function. Can you refactor it?"
            (~150 input tokens)
            Response: [refactored function] (~400 output tokens)
            
Message 3: "Now the second function..."
            (~150 input tokens)
            Response: [refactored function] (~400 output tokens)
            
Message 4: "Third function..."
            (~150 input tokens)
            Response: [refactored function] (~400 output tokens)
            
Message 5: "Fourth function..."
            (~150 input tokens)
            Response: [refactored function] (~400 output tokens)
            
Message 6: "Fifth function..."
            (~150 input tokens)
            Response: [refactored function] (~400 output tokens)

TOTAL: (1,200 + 150×5) input + (1,500 + 400×5) output
     = 1,950 input + 3,500 output
     = 5,450 tokens
     = 6 messages
     = 12 minutes
```

#### ✅ EFFICIENT APPROACH

```
Message 1: "Refactor these 5 functions:
           [paste ONLY the 5 functions, ~150 lines]
           ($450 input tokens)
           Response: [all 5 refactored] (~500 output tokens)

TOTAL: 450 input + 500 output
     = 950 tokens
     = 1 message
     = 2 minutes

SAVINGS: 5,450 → 950 = 82% reduction
```

---

## Token-Saving Pro Tips

### Tip 1: Reuse System Prompts

Once you craft a good system prompt, keep it:

```javascript
// Save this in your VS Code snippets
const SYSTEM_PROMPTS = {
  codeReview: "You are a code reviewer. Output ONLY JSON...",
  bugFix: "You fix bugs. Respond ONLY with fixed code...",
  refactor: "You refactor code for clarity. Respond with code only...",
};
```

**Savings: 30-50 tokens per use (prevents re-explaining context)**

### Tip 2: Create Templates for Recurring Tasks

If you do code review weekly:

```
WEEKLY CODE REVIEW TEMPLATE:
- Break code into 3-4 sections
- Review each in separate (fast) conversation
- Use Haiku + JSON format
- Total cost: ~2,000 tokens vs. ~5,000 manually
```

### Tip 3: Batch by Task Type, Not by Time

Bad: "Let me finish this in one conversation"
Good: "Let me batch all code reviews together"

### Tip 4: Leverage Model Strengths

- **Haiku**: Simple refactoring, formatting, single functions
- **Sonnet**: Complex logic, debugging, performance analysis
- **Opus**: Architecture, research, system design

Use the right tool for the job.

### Tip 5: Pre-Process Before Sending

If you can simplify the task yourself, do it:

```
Instead of: "My app is slow, help me optimize"
           (Needs whole app context, 5K+ tokens)

Do this:    1. Profile locally to find bottleneck
            2. Isolate that function (50 lines)
            3. "Optimize this function" (400 tokens)
```

**Savings: 5K → 400 = 92% reduction**

---

## Template Checklists

### Before Using Any Template:

- ☐ Is my input <500 lines of code?
- ☐ Have I specified response format?
- ☐ Have I specified length/token limit?
- ☐ Am I using the cheapest capable model?
- ☐ Can I batch this with other requests?
- ☐ Is my system prompt clear and concise?
- ☐ Have I eliminated unnecessary context?

### After Getting Response:

- ☐ Does it match the format I asked for?
- ☐ Is it the expected length?
- ☐ Can I implement it immediately?
- ☐ Should I start a fresh conversation for follow-ups?

---

## Customizing Templates

All templates are modular. You can mix and match:

**Core template structure:**
```
[Optional: System Prompt - 1-3 sentences]
[User Message: Context - 2-3 sentences]
[Specific Code/Content]
[Response Format - be specific]
```

Whenever a template shows "[PASTE X LINES]", estimate:
- ~0.25 tokens per character
- E.g., 100 lines of code ≈ 250 tokens

Adjust templates based on your needs. The key principles:
1. **Be specific** (not verbose)
2. **Specify format** (not ambiguous)
3. **Provide context** (not make agent hunt)
4. **Batch when possible** (not repeat context)
