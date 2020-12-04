from __future__ import absolute_import, print_function

from django.db import models
from django.utils import timezone

from sentry.db.models import FlexibleForeignKey, Model, sane_repr


class Dashboard(Model):
    """
    A dashboard.
    """

    __core__ = True

    title = models.CharField(max_length=255)
    created_by = FlexibleForeignKey("sentry.User")
    organization = FlexibleForeignKey("sentry.Organization")
    date_added = models.DateTimeField(default=timezone.now)

    class Meta:
        app_label = "sentry"
        db_table = "sentry_dashboard"
        unique_together = (("organization", "title"),)

    __repr__ = sane_repr("organization", "title")


class DashboardTombstone(Model):
    """
    A tombstone to indicate that a pre-built dashboard
    has been replaced or deleted for an organization.
    """

    __core__ = True

    slug = models.CharField(max_length=255)
    organization = FlexibleForeignKey("sentry.Organization")
    date_added = models.DateTimeField(default=timezone.now)

    class Meta:
        app_label = "sentry"
        db_table = "sentry_dashboardtombstone"
        unique_together = (("organization", "slug"),)

    __repr__ = sane_repr("organization", "slug")


def get_prebuilt_dashboards(organization, title_query=None):
    query = list(DashboardTombstone.objects.filter(organization=organization).values_list("slug"))
    tombstones = [v["slug"] for v in query]
    results = []
    for data in PREBUILT_DASHBOARDS:
        if title_query and title_query.lower() not in data["title"].lower():
            continue
        if data["id"] not in tombstones:
            results.append(data)
    return results


PREBUILT_DASHBOARDS = [
    {
        "id": "default-overview",
        "title": "Dashboard",
        "widgets": [
            {
                "title": "Events",
                "displayType": "line",
                "interval": "5m",
                "queries": [
                    {
                        "name": "Events",
                        "conditions": "!event.type:transaction",
                        "fields": ["count()"],
                    }
                ],
            }
        ],
    }
]
