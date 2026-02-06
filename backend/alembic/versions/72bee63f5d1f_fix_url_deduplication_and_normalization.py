"""fix_url_deduplication_and_normalization

Revision ID: 72bee63f5d1f
Revises: 3bdd5209d0fb
Create Date: 2026-02-05 16:42:08.752015

"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa



revision = "72bee63f5d1f"
down_revision = "3bdd5209d0fb"
branch_labels = None
depends_on = None


def upgrade():
    """
     Fix URL deduplication issues:
    1. Strip query params and trailing slashes from existing URLs
    2. Merge duplicate products
    3. Add trigger to auto-normalize URLs on insert/update
    """





    print(" Normalizing existing URLs...")


    op.execute(
        """
        UPDATE tracked_products
        SET url = RTRIM(SPLIT_PART(SPLIT_PART(url, '?', 1), '#', 1), '/');
    """
    )


    op.execute(
        """
        UPDATE tracked_products
        SET canonical_url = RTRIM(SPLIT_PART(SPLIT_PART(canonical_url, '?', 1), '#', 1), '/')
        WHERE canonical_url IS NOT NULL;
    """
    )





    print(" Merging duplicate products...")


    op.execute(
        """
        -- Create temp table with duplicate mapping
        CREATE TEMP TABLE duplicate_mapping AS
        WITH ranked_products AS (
            SELECT
                id,
                canonical_url,
                ROW_NUMBER() OVER (
                    PARTITION BY canonical_url
                    ORDER BY id ASC
                ) as rn
            FROM tracked_products
            WHERE canonical_url IS NOT NULL
        )
        SELECT
            d.id as duplicate_id,
            o.id as original_id
        FROM ranked_products d
        INNER JOIN ranked_products o
            ON d.canonical_url = o.canonical_url
            AND o.rn = 1
        WHERE d.rn > 1;

        -- Move snapshots from duplicates to originals
        UPDATE price_snapshots ps
        SET tracked_product_id = dm.original_id
        FROM duplicate_mapping dm
        WHERE ps.tracked_product_id = dm.duplicate_id;

        -- Move AI insights from duplicates to originals
        UPDATE ai_insights ai
        SET product_id = dm.original_id
        FROM duplicate_mapping dm
        WHERE ai.product_id = dm.duplicate_id;

        -- Delete duplicate products
        DELETE FROM tracked_products tp
        USING duplicate_mapping dm
        WHERE tp.id = dm.duplicate_id;

        DROP TABLE duplicate_mapping;
    """
    )





    print(" Creating URL normalization function...")

    op.execute(
        """
        CREATE OR REPLACE FUNCTION normalize_tracked_product_url()
        RETURNS TRIGGER AS $$
        BEGIN
            -- Strip query params, anchors, and trailing slashes from url
            NEW.url := RTRIM(SPLIT_PART(SPLIT_PART(NEW.url, '?', 1), '#', 1), '/');

            -- Same for canonical_url
            IF NEW.canonical_url IS NOT NULL THEN
                NEW.canonical_url := RTRIM(SPLIT_PART(SPLIT_PART(NEW.canonical_url, '?', 1), '#', 1), '/');
            END IF;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """
    )





    print(" Creating normalization trigger...")

    op.execute(
        """
        DROP TRIGGER IF EXISTS normalize_url_trigger ON tracked_products;

        CREATE TRIGGER normalize_url_trigger
            BEFORE INSERT OR UPDATE ON tracked_products
            FOR EACH ROW
            EXECUTE FUNCTION normalize_tracked_product_url();
    """
    )





    print(" Ensuring unique constraints...")


    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'tracked_products_url_key'
            ) THEN
                ALTER TABLE tracked_products
                ADD CONSTRAINT tracked_products_url_key UNIQUE (url);
            END IF;
        END $$;
    """
    )


    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'tracked_products_canonical_url_key'
            ) THEN
                ALTER TABLE tracked_products
                ADD CONSTRAINT tracked_products_canonical_url_key UNIQUE (canonical_url);
            END IF;
        END $$;
    """
    )

    print(" URL deduplication migration complete!")


def downgrade():
    """
    Rollback changes (optional - usually not needed for data migrations)
    """


    op.execute("DROP TRIGGER IF EXISTS normalize_url_trigger ON tracked_products;")


    op.execute("DROP FUNCTION IF EXISTS normalize_tracked_product_url();")


    op.execute(
        """
        DO $$
        BEGIN
            ALTER TABLE tracked_products DROP CONSTRAINT IF EXISTS tracked_products_url_key;
            ALTER TABLE tracked_products DROP CONSTRAINT IF EXISTS tracked_products_canonical_url_key;
        EXCEPTION
            WHEN undefined_object THEN NULL;
        END $$;
    """
    )

    print("  Rolled back URL normalization (duplicates may return)")
