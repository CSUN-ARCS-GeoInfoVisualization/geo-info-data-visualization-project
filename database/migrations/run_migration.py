"""
Database migration runner for wildfire prediction system.
Executes SQL schema files in order.
"""

import os
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from connection import get_db_cursor, execute_sql_file, test_connection
from config import SCHEMA_DIR

# Define migration steps in order
MIGRATION_STEPS = [
    'step_01_create_database.sql',
    'step_02_lookup_tables.sql',
    'step_03_main_observations.sql',
    'step_04_spatial_indexes.sql',
]


def run_migrations(start_step=1, end_step=None, verbose=True):
    """Run database migrations step by step.
    
    Args:
        start_step: Step number to start from (1-indexed)
        end_step: Step number to end at (None = all remaining steps)
        verbose: Print progress messages
    
    Returns:
        True if all migrations succeeded, False otherwise
    """
    if verbose:
        print("=" * 60)
        print("WILDFIRE PREDICTION DATABASE MIGRATION")
        print("=" * 60)
        print()
    
    # Test connection first
    if verbose:
        print("Testing database connection...")
    if not test_connection():
        print("✗ Cannot connect to database. Check your configuration.")
        return False
    print()
    
    # Determine which steps to run
    if end_step is None:
        end_step = len(MIGRATION_STEPS)
    
    steps_to_run = MIGRATION_STEPS[start_step-1:end_step]
    
    if verbose:
        print(f"Running {len(steps_to_run)} migration step(s)...")
        print()
    
    # Execute each step
    success_count = 0
    for i, step_file in enumerate(steps_to_run, start=start_step):
        if verbose:
            print(f"Step {i}/{len(MIGRATION_STEPS)}: {step_file}")
        
        filepath = os.path.join(SCHEMA_DIR, step_file)
        
        if not os.path.exists(filepath):
            print(f"  ✗ File not found: {filepath}")
            continue
        
        if execute_sql_file(filepath, verbose=False):
            success_count += 1
            if verbose:
                print(f"  ✓ Completed successfully")
        else:
            if verbose:
                print(f"  ✗ Failed")
            return False
        
        if verbose:
            print()
    
    if verbose:
        print("=" * 60)
        print(f"Migration complete: {success_count}/{len(steps_to_run)} steps succeeded")
        print("=" * 60)
    
    return success_count == len(steps_to_run)


def main():
    """Main entry point for migration script."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Run database migrations')
    parser.add_argument('--start', type=int, default=1,
                       help='Step number to start from (default: 1)')
    parser.add_argument('--end', type=int, default=None,
                       help='Step number to end at (default: all)')
    parser.add_argument('--quiet', action='store_true',
                       help='Suppress progress messages')
    
    args = parser.parse_args()
    
    success = run_migrations(
        start_step=args.start,
        end_step=args.end,
        verbose=not args.quiet
    )
    
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
