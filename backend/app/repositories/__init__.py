# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from app.repositories import (
    activity_repo,
    annotation_repo,
    collection_repo,
    comment_repo,
    gallery_repo,
    image_repo,
    notification_repo,
    settings_repo,
    vote_repo,
    zip_job_repo,
)

__all__ = [
    "activity_repo",
    "annotation_repo",
    "collection_repo",
    "comment_repo",
    "gallery_repo",
    "image_repo",
    "notification_repo",
    "settings_repo",
    "vote_repo",
    "zip_job_repo",
]
