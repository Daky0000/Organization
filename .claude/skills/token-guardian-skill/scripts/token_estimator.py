#!/usr/bin/env python3
"""
Token Guardian: Token Cost Estimator

Estimates token consumption for prompts before sending to agents.
Usage: python token_estimator.py [options]

Examples:
  python token_estimator.py --file code.js                  # Estimate tokens for file
  python token_estimator.py --text "Your prompt here"        # Estimate prompt tokens
  python token_estimator.py --conversation 15 --avg 500      # Estimate conversation cost
  python token_estimator.py --compare size                   # Compare different approaches
"""

import sys
import os
import argparse
from pathlib import Path


class TokenEstimator:
    """Estimates token consumption based on character count."""
    
    # Empirical token-to-character ratios
    TOKENS_PER_CHAR = 0.25  # ~4 characters per token (1 token ≈ 4 chars)
    CODE_MULTIPLIER = 1.2     # Code has more tokens due to special chars
    JSON_MULTIPLIER = 1.1     # JSON has more tokens due to structure
    
    def __init__(self):
        self.results = []
    
    def estimate_tokens(self, text, content_type='text'):
        """Estimate tokens in text based on content type."""
        char_count = len(text)
        
        multiplier = 1.0
        if content_type == 'code':
            multiplier = self.CODE_MULTIPLIER
        elif content_type == 'json':
            multiplier = self.JSON_MULTIPLIER
        
        tokens = int(char_count * self.TOKENS_PER_CHAR * multiplier)
        return tokens, char_count
    
    def estimate_response(self, prompt_tokens, verbosity='normal'):
        """
        Estimate response tokens based on prompt size and verbosity.
        
        Verbosity levels:
        - 'code_only': ~200 tokens (short code)
        - 'brief': prompt_tokens * 0.5 (brief answer)
        - 'normal': prompt_tokens * 1.0 (typical response)
        - 'verbose': prompt_tokens * 2.0 (detailed explanation)
        - 'analysis': prompt_tokens * 3.0 (deep analysis)
        """
        multipliers = {
            'code_only': 0.2,
            'brief': 0.5,
            'normal': 1.0,
            'verbose': 2.0,
            'analysis': 3.0
        }
        
        multiplier = multipliers.get(verbosity, 1.0)
        response_tokens = int(prompt_tokens * multiplier)
        
        # Minimum response size
        if response_tokens < 50:
            response_tokens = 50
        
        return response_tokens
    
    def estimate_model_cost(self, input_tokens, output_tokens, model='sonnet'):
        """
        Estimate cost based on model pricing.
        This is relative cost, not actual USD.
        
        Models (relative cost):
        - haiku: 1x input, 3x output (cheapest)
        - sonnet: 3x input, 15x output (balanced)
        - opus: 15x input, 75x output (most expensive)
        """
        multipliers = {
            'haiku': {'input': 1, 'output': 3},
            'sonnet': {'input': 3, 'output': 15},
            'opus': {'input': 15, 'output': 75}
        }
        
        m = multipliers.get(model, multipliers['sonnet'])
        cost = (input_tokens * m['input']) + (output_tokens * m['output'])
        return cost
    
    def estimate_conversation(self, num_messages, avg_message_tokens=500, avg_response_tokens=700):
        """
        Estimate total tokens in a conversation.
        
        Includes both messages and responses.
        """
        total_tokens = 0
        
        for i in range(num_messages):
            # Each message adds cumulative cost (context grows)
            context_multiplier = 1 + (i * 0.1)  # Context grows ~10% per message
            message_tokens = int(avg_message_tokens * context_multiplier)
            response_tokens = int(avg_response_tokens * context_multiplier)
            
            total_tokens += message_tokens + response_tokens
        
        return total_tokens
    
    def compare_approaches(self, approach_type='batch_vs_individual'):
        """Compare token costs of different approaches."""
        comparisons = {
            'batch_vs_individual': {
                'batch': self._compare_batch,
                'individual': self._compare_individual
            },
            'models': self._compare_models,
            'conversation_length': self._compare_conversation_length
        }
        
        return comparisons.get(approach_type)
    
    def _compare_batch(self):
        """Cost of batching 5 functions: 5x250 char each = 1250 chars total."""
        tokens = self.estimate_tokens('x' * 1250, 'code')[0]
        response = self.estimate_response(tokens, 'code_only')
        total = tokens + response
        return total
    
    def _compare_individual(self):
        """Cost of asking about each function individually: 5x (250 chars + overhead)."""
        single_cost = self.estimate_tokens('x' * 250, 'code')[0] + self.estimate_response(250, 'code_only')
        total = single_cost * 5 + 1000  # +1000 for context overhead
        return total
    
    def _compare_models(self):
        """Compare models for a typical task."""
        input_tokens = 500
        output_tokens = 400
        
        results = {}
        for model in ['haiku', 'sonnet', 'opus']:
            cost = self.estimate_model_cost(input_tokens, output_tokens, model)
            results[model] = cost
        
        return results
    
    def _compare_conversation_length(self):
        """Compare token cost by conversation length."""
        results = {}
        for msg_count in [1, 5, 10, 20, 50]:
            tokens = self.estimate_conversation(msg_count)
            results[f'{msg_count} messages'] = tokens
        
        return results


def format_output(title, tokens, chars=None, savings=None):
    """Format output nicely."""
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")
    print(f"  Estimated tokens:     {tokens:,}")
    if chars:
        print(f"  Characters:           {chars:,}")
        print(f"  Chars/token ratio:    {chars/tokens:.1f}:1")
    if savings:
        print(f"  Savings vs. wasteful: {savings}%")


def main():
    parser = argparse.ArgumentParser(
        description='Token Guardian: Estimate token costs before sending prompts',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  %(prog)s --file code.js
  %(prog)s --text "Your prompt here"
  %(prog)s --conversation 15 --avg-msg 500 --avg-resp 700
  %(prog)s --compare batch_vs_individual
  %(prog)s --model-cost 500 400 --model sonnet
        '''
    )
    
    parser.add_argument('--file', help='Analyze token cost of a file')
    parser.add_argument('--text', help='Analyze token cost of text')
    parser.add_argument('--type', choices=['code', 'text', 'json'], default='code',
                       help='Content type for multiplier (default: code)')
    parser.add_argument('--response', choices=['code_only', 'brief', 'normal', 'verbose', 'analysis'],
                       default='normal', help='Expected response verbosity')
    parser.add_argument('--conversation', type=int, help='Estimate cost of N-message conversation')
    parser.add_argument('--avg-msg', type=int, default=500, help='Average message size (chars)')
    parser.add_argument('--avg-resp', type=int, default=700, help='Average response size (chars)')
    parser.add_argument('--compare', choices=['batch_vs_individual', 'models', 'conversation_length'],
                       help='Compare different approaches')
    parser.add_argument('--model-cost', nargs=2, type=int, metavar=('INPUT', 'OUTPUT'),
                       help='Calculate cost for input/output token counts')
    parser.add_argument('--model', choices=['haiku', 'sonnet', 'opus'], default='sonnet',
                       help='Model for cost calculation (default: sonnet)')
    parser.add_argument('--save-tokens', type=float, help='Calculate if tokens >= this amount warrant agent use')
    
    args = parser.parse_args()
    
    estimator = TokenEstimator()
    
    # File analysis
    if args.file:
        try:
            with open(args.file, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            tokens, chars = estimator.estimate_tokens(content, args.type)
            format_output(f"File Analysis: {args.file}", tokens, chars)
            
            # Estimate response
            response_tokens = estimator.estimate_response(tokens, args.response)
            print(f"\n  Expected response ({args.response}): {response_tokens:,} tokens")
            
            # Total cost
            total = tokens + response_tokens
            print(f"  Total cost (input + output): {total:,} tokens")
            
            # Model comparison
            print(f"\n  Model cost comparison:")
            for model in ['haiku', 'sonnet', 'opus']:
                cost = estimator.estimate_model_cost(tokens, response_tokens, model)
                print(f"    {model.capitalize():8} → {cost:,} units")
        
        except FileNotFoundError:
            print(f"Error: File '{args.file}' not found")
            sys.exit(1)
    
    # Text analysis
    elif args.text:
        tokens, chars = estimator.estimate_tokens(args.text, args.type)
        format_output("Text Analysis", tokens, chars)
        
        response_tokens = estimator.estimate_response(tokens, args.response)
        print(f"  Expected response ({args.response}): {response_tokens:,} tokens")
        
        total = tokens + response_tokens
        print(f"  Total cost: {total:,} tokens")
    
    # Conversation analysis
    elif args.conversation:
        total = estimator.estimate_conversation(args.conversation, args.avg_msg, args.avg_resp)
        format_output(f"Conversation: {args.conversation} messages", total)
        
        avg_per_msg = total // args.conversation
        print(f"  Average tokens per message: {avg_per_msg:,}")
    
    # Comparisons
    elif args.compare:
        if args.compare == 'batch_vs_individual':
            batch_cost = estimator._compare_batch()
            individual_cost = estimator._compare_individual()
            savings = 100 - int((batch_cost / individual_cost) * 100)
            
            print(f"\n{'='*60}")
            print(f"  Batch vs. Individual (5 functions)")
            print(f"{'='*60}")
            print(f"  Batch approach:        {batch_cost:,} tokens")
            print(f"  Individual approach:   {individual_cost:,} tokens")
            print(f"  Savings:               {savings}%")
        
        elif args.compare == 'models':
            results = estimator._compare_models()
            print(f"\n{'='*60}")
            print(f"  Model Cost Comparison (500 input, 400 output tokens)")
            print(f"{'='*60}")
            for model, cost in results.items():
                multiplier = cost // results['haiku']
                print(f"  {model.capitalize():8} → {cost:,} units ({multiplier}x Haiku)")
        
        elif args.compare == 'conversation_length':
            results = estimator._compare_conversation_length()
            print(f"\n{'='*60}")
            print(f"  Conversation Length Impact")
            print(f"{'='*60}")
            for length, tokens in results.items():
                print(f"  {length:15} → {tokens:,} tokens")
    
    # Model cost calculation
    elif args.model_cost:
        input_tokens, output_tokens = args.model_cost
        cost = estimator.estimate_model_cost(input_tokens, output_tokens, args.model)
        
        print(f"\n{'='*60}")
        print(f"  Cost Calculation: {args.model.capitalize()}")
        print(f"{'='*60}")
        print(f"  Input tokens:      {input_tokens:,}")
        print(f"  Output tokens:     {output_tokens:,}")
        print(f"  Total cost:        {cost:,} units")
    
    else:
        # Show quick reference if no args
        print("\n" + "="*60)
        print("  Token Guardian: Quick Estimation Guide")
        print("="*60)
        print("\n  Quick estimates:")
        for size in [100, 500, 1000, 5000]:
            tokens, _ = estimator.estimate_tokens('x' * size, 'code')
            print(f"    {size:,} chars → ~{tokens:,} tokens")
        
        print("\n  Response estimates (normal verbosity):")
        for input_t in [250, 500, 1000]:
            response = estimator.estimate_response(input_t, 'normal')
            total = input_t + response
            print(f"    {input_t:,} token input → {response:,} token response ({total:,} total)")
        
        print("\n  Use --help for full options")


if __name__ == '__main__':
    main()
