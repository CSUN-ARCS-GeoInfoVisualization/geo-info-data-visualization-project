"""
Main Integration Script

Orchestrates the complete data integration pipeline:
1. Load preprocessed data from ML sources
2. Perform spatial-temporal joins
3. Map to database schema
4. Bulk insert into database

Usage:
    python run_integration.py [options]

Options:
    --date-start YYYY-MM-DD   Start date for data range
    --date-end YYYY-MM-DD     End date for data range
    --batch-size N            Batch size for insertion (default: 1000)
    --include-elevation       Include elevation data
    --fire-only               Only insert fire observations
    --with-negatives          Include negative (no-fire) samples
    --checkpoint FILE         Use checkpoint file for resumability
"""

import sys
import os
import argparse
from datetime import datetime
from typing import Optional

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from integration.data_loader import (
    load_firms_data,
    load_noaa_data,
    check_preprocessed_data_availability,
    get_data_summary
)

from integration.spatial_join import (
    create_unified_observations,
    create_negative_samples,
    combine_positive_negative_samples
)

from integration.field_mapper import (
    batch_map_firms_data
)

from integration.bulk_loader import (
    insert_with_progress,
    get_insertion_statistics
)


def check_prerequisites():
    """Check if all prerequisites are met."""
    print("=== Checking Prerequisites ===\n")
    
    # Check preprocessed data availability
    availability = check_preprocessed_data_availability()
    
    all_ready = True
    
    print("Preprocessed Data:")
    for key, value in availability.items():
        if isinstance(value, bool):
            status = "✓" if value else "✗"
            print(f"  {status} {key}")
            if not value and key != 'usgs_aligned':  # USGS is optional
                all_ready = False
        elif key == 'usgs_tiles_count':
            print(f"    USGS tiles: {value}")
    
    # Check database connection
    print("\nDatabase Connection:")
    try:
        from database.connection import test_connection
        if test_connection():
            print("  ✓ Database connection OK")
        else:
            print("  ✗ Database connection failed")
            all_ready = False
    except ImportError:
        print("  ✗ Database module not found")
        all_ready = False
    except Exception as e:
        print(f"  ✗ Database error: {e}")
        all_ready = False
    
    print()
    return all_ready


def run_integration(date_start: Optional[str] = None,
                   date_end: Optional[str] = None,
                   batch_size: int = 1000,
                   include_elevation: bool = False,
                   fire_only: bool = True,
                   with_negatives: bool = False,
                   checkpoint_file: Optional[str] = None):
    """
    Run the complete integration pipeline.
    
    Args:
        date_start: Start date (YYYY-MM-DD)
        date_end: End date (YYYY-MM-DD)
        batch_size: Batch size for database insertion
        include_elevation: Whether to include elevation data
        fire_only: Only process fire observations
        with_negatives: Include negative samples for ML training
        checkpoint_file: Path to checkpoint file for resumability
    """
    start_time = datetime.now()
    
    print("="*70)
    print("GEO INFO DATA INTEGRATION PIPELINE")
    print("="*70)
    print(f"Started: {start_time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    
    # Configuration
    print("Configuration:")
    print(f"  Date range: {date_start or 'all'} to {date_end or 'all'}")
    print(f"  Batch size: {batch_size}")
    print(f"  Include elevation: {include_elevation}")
    print(f"  Fire only: {fire_only}")
    print(f"  With negatives: {with_negatives}")
    print()
    
    # Step 1: Check prerequisites
    if not check_prerequisites():
        print("❌ Prerequisites not met. Please fix issues and try again.")
        return False
    
    # Step 2: Load FIRMS data
    print("="*70)
    print("STEP 1: Loading FIRMS Fire Detection Data")
    print("="*70)
    
    try:
        date_range = (date_start, date_end) if date_start and date_end else None
        firms_df = load_firms_data(aligned=True, date_range=date_range)
        print(f"✓ Loaded {len(firms_df):,} fire detections\n")
    except Exception as e:
        print(f"❌ Error loading FIRMS data: {e}\n")
        return False
    
    # Step 3: Load NOAA data
    print("="*70)
    print("STEP 2: Loading NOAA Weather Data")
    print("="*70)
    
    try:
        noaa_df = load_noaa_data(aligned=True, date_range=date_range)
        print(f"✓ Loaded {len(noaa_df):,} weather observations\n")
    except Exception as e:
        print(f"⚠ Warning: Could not load NOAA data: {e}")
        print("  Continuing without weather data...\n")
        noaa_df = None
    
    # Step 4: Create unified observations
    print("="*70)
    print("STEP 3: Creating Unified Observations")
    print("="*70)
    
    try:
        unified_df = create_unified_observations(
            firms_df,
            noaa_df,
            include_elevation=include_elevation,
            fire_only=fire_only
        )
        print(f"✓ Created {len(unified_df):,} unified observations\n")
    except Exception as e:
        print(f"❌ Error creating unified observations: {e}\n")
        return False
    
    # Step 5: Add negative samples if requested
    if with_negatives and noaa_df is not None:
        print("="*70)
        print("STEP 4: Adding Negative Samples")
        print("="*70)
        
        try:
            negative_df = create_negative_samples(unified_df, noaa_df, sample_ratio=0.5)
            unified_df = combine_positive_negative_samples(unified_df, negative_df)
            print()
        except Exception as e:
            print(f"⚠ Warning: Could not create negative samples: {e}")
            print("  Continuing with fire observations only...\n")
    
    # Step 6: Map to database schema
    print("="*70)
    print("STEP 5: Mapping to Database Schema")
    print("="*70)
    
    try:
        observations = batch_map_firms_data(
            unified_df,
            include_weather=(noaa_df is not None),
            include_elevation=include_elevation
        )
        print(f"✓ Mapped {len(observations):,} observations")
        print(f"  Valid observations: {len(observations)}\n")
    except Exception as e:
        print(f"❌ Error mapping observations: {e}\n")
        return False
    
    # Step 7: Insert into database
    print("="*70)
    print("STEP 6: Inserting into Database")
    print("="*70)
    
    try:
        if checkpoint_file:
            from integration.bulk_loader import insert_observations_incremental
            stats = insert_observations_incremental(
                observations,
                checkpoint_file=checkpoint_file,
                batch_size=batch_size
            )
        else:
            stats = insert_with_progress(
                observations,
                batch_size=batch_size,
                show_progress=True
            )
        print()
    except Exception as e:
        print(f"❌ Error inserting observations: {e}\n")
        return False
    
    # Step 8: Show final statistics
    print("="*70)
    print("INTEGRATION COMPLETE")
    print("="*70)
    
    duration = (datetime.now() - start_time).total_seconds()
    
    print(f"\nExecution time: {duration:.2f} seconds")
    print(f"\nFinal Statistics:")
    print(f"  Records processed: {stats['total']:,}")
    print(f"  Successfully inserted: {stats['inserted']:,}")
    print(f"  Failed: {stats['failed']:,}")
    
    # Get database statistics
    print(f"\nDatabase Statistics:")
    db_stats = get_insertion_statistics(
        start_date=date_start,
        end_date=date_end
    )
    
    if db_stats:
        print(f"  Total observations: {db_stats.get('total_observations', 0):,}")
        print(f"  Fire occurrences: {db_stats.get('fire_count', 0):,}")
        print(f"  Date range: {db_stats.get('earliest_date')} to {db_stats.get('latest_date')}")
        print(f"  Data sources: {db_stats.get('data_sources', 0)}")
    
    print("\n" + "="*70)
    print("✓ Integration pipeline completed successfully!")
    print("="*70 + "\n")
    
    return True


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Integrate ML data sources with core database',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic integration (all data)
  python run_integration.py
  
  # Specific date range
  python run_integration.py --date-start 2020-01-01 --date-end 2020-12-31
  
  # With elevation and negative samples
  python run_integration.py --include-elevation --with-negatives
  
  # With checkpoint for resumability
  python run_integration.py --checkpoint integration_checkpoint.txt
        """
    )
    
    parser.add_argument('--date-start', type=str, help='Start date (YYYY-MM-DD)')
    parser.add_argument('--date-end', type=str, help='End date (YYYY-MM-DD)')
    parser.add_argument('--batch-size', type=int, default=1000, help='Batch size for insertion')
    parser.add_argument('--include-elevation', action='store_true', help='Include elevation data')
    parser.add_argument('--fire-only', action='store_true', default=True, help='Only fire observations')
    parser.add_argument('--with-negatives', action='store_true', help='Include negative samples')
    parser.add_argument('--checkpoint', type=str, help='Checkpoint file path')
    parser.add_argument('--check-only', action='store_true', help='Only check prerequisites')
    
    args = parser.parse_args()
    
    # Just check prerequisites
    if args.check_only:
        if check_prerequisites():
            print("✓ All prerequisites met!")
            sys.exit(0)
        else:
            print("❌ Some prerequisites not met")
            sys.exit(1)
    
    # Run integration
    success = run_integration(
        date_start=args.date_start,
        date_end=args.date_end,
        batch_size=args.batch_size,
        include_elevation=args.include_elevation,
        fire_only=args.fire_only,
        with_negatives=args.with_negatives,
        checkpoint_file=args.checkpoint
    )
    
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()

