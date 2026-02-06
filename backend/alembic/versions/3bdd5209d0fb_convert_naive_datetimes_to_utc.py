"""convert_naive_datetimes_to_utc

Revision ID: 3bdd5209d0fb
Revises: cbcf962ada23
Create Date: 2026-02-04 16:17:20.357593

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "3bdd5209d0fb"
down_revision: Union[str, Sequence[str], None] = "cbcf962ada23"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Convert all existing naive datetimes to timezone-aware UTC
    op.execute(
        """
        UPDATE tracked_products 
        SET 
            last_scraped_at = last_scraped_at AT TIME ZONE 'UTC',
            next_run_at = next_run_at AT TIME ZONE 'UTC',
            created_at = created_at AT TIME ZONE 'UTC',
            updated_at = updated_at AT TIME ZONE 'UTC'
        WHERE last_scraped_at IS NOT NULL OR next_run_at IS NOT NULL;
        
        UPDATE price_snapshots
        SET fetched_at = fetched_at AT TIME ZONE 'UTC'
        WHERE fetched_at IS NOT NULL;
        
        UPDATE ai_insights
        SET created_at = created_at AT TIME ZONE 'UTC'
        WHERE created_at IS NOT NULL;
    """
    )


def downgrade() -> None:
    pass  # Can't reverse timezone conversion safely:
    pass
