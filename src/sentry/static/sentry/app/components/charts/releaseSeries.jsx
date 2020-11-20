import React from 'react';
import {withRouter} from 'react-router';
import isEqual from 'lodash/isEqual';
import memoize from 'lodash/memoize';
import partition from 'lodash/partition';
import PropTypes from 'prop-types';

import {addErrorMessage} from 'app/actionCreators/indicator';
import MarkLine from 'app/components/charts/components/markLine';
import {t} from 'app/locale';
import SentryTypes from 'app/sentryTypes';
import {escape} from 'app/utils';
import {getFormattedDate, getUtcDateString} from 'app/utils/dates';
import {formatVersion} from 'app/utils/formatters';
import parseLinkHeader from 'app/utils/parseLinkHeader';
import theme from 'app/utils/theme';
import withApi from 'app/utils/withApi';
import withOrganization from 'app/utils/withOrganization';

// This is not an exported action/function because releases list uses AsyncComponent
// and this is not re-used anywhere else afaict
async function getOrganizationReleases(api, organization, conditions = null) {
  const query = {};
  Object.keys(conditions).forEach(key => {
    let value = conditions[key];
    if (value && (key === 'start' || key === 'end')) {
      value = getUtcDateString(value);
    }
    if (value) {
      query[key] = value;
    }
  });
  api.clear();
  return api.requestPromise(`/organizations/${organization.slug}/releases/stats/`, {
    includeAllArgs: true,
    method: 'GET',
    query,
  });
}

class ReleaseSeries extends React.Component {
  static propTypes = {
    api: PropTypes.object,
    router: PropTypes.object,
    organization: SentryTypes.Organization,
    projects: PropTypes.arrayOf(PropTypes.number),
    environments: PropTypes.arrayOf(PropTypes.string),

    period: PropTypes.string,
    start: PropTypes.oneOfType([PropTypes.instanceOf(Date), PropTypes.string]),
    end: PropTypes.oneOfType([PropTypes.instanceOf(Date), PropTypes.string]),
    utc: PropTypes.bool,
    // Array of releases, if empty, component will fetch releases itself
    releases: PropTypes.arrayOf(SentryTypes.Release),
    tooltip: SentryTypes.EChartsTooltip,
    queryExtra: PropTypes.object,

    memoized: PropTypes.bool,
    emphasizeReleases: PropTypes.arrayOf(PropTypes.string),
  };

  state = {
    releases: null,
    releaseSeries: [],
  };

  componentDidMount() {
    this._isMounted = true;
    const {releases} = this.props;

    if (releases) {
      // No need to fetch releases if passed in from props
      this.setReleasesWithSeries(releases);
      return;
    }

    this.fetchData();
  }

  componentDidUpdate(prevProps) {
    if (
      !isEqual(prevProps.projects, this.props.projects) ||
      !isEqual(prevProps.environments, this.props.environments) ||
      !isEqual(prevProps.start, this.props.start) ||
      !isEqual(prevProps.end, this.props.end) ||
      !isEqual(prevProps.period, this.props.period)
    ) {
      this.fetchData();
    }
  }

  componentWillUnmount() {
    this._isMounted = false;
    this.props.api.clear();
  }

  getOrganizationReleasesMemoized = memoize(
    async (api, conditions, organization) =>
      await getOrganizationReleases(api, conditions, organization),
    (_, __, conditions) => `${Object.values(conditions).map(JSON.stringify).join('-')}`
  );

  async fetchData() {
    const {
      api,
      organization,
      projects,
      environments,
      period,
      start,
      end,
      memoized,
    } = this.props;
    const conditions = {
      start,
      end,
      project: projects,
      environment: environments,
      statsPeriod: period,
    };
    let hasMore = true;
    const releases = [];
    while (hasMore) {
      try {
        const getReleases = memoized
          ? this.getOrganizationReleasesMemoized
          : getOrganizationReleases;
        const [newReleases, , xhr] = await getReleases(api, organization, conditions);
        releases.push(...newReleases);
        if (this._isMounted) {
          this.setReleasesWithSeries(releases);
        }

        const pageLinks = xhr && xhr.getResponseHeader('Link');
        if (pageLinks) {
          const paginationObject = parseLinkHeader(pageLinks);
          hasMore = paginationObject && paginationObject.next.results;
          conditions.cursor = paginationObject.next.cursor;
        } else {
          hasMore = false;
        }
      } catch {
        addErrorMessage(t('Error fetching releases'));
        hasMore = false;
      }
    }
  }

  setReleasesWithSeries(releases) {
    const {emphasizeReleases = []} = this.props;
    const [unemphasizedReleases, emphasizedReleases] = partition(
      releases,
      release => !emphasizeReleases.includes(release.version)
    );
    const releaseSeries = [];
    if (unemphasizedReleases.length) {
      releaseSeries.push(this.getReleaseSeries(unemphasizedReleases));
    }
    if (emphasizedReleases.length) {
      releaseSeries.push(this.getReleaseSeries(emphasizedReleases, 0.8));
    }

    this.setState({
      releases,
      releaseSeries,
    });
  }

  getReleaseSeries = (releases, opacity = 0.3) => {
    const {organization, router, tooltip, queryExtra} = this.props;

    const query = {...queryExtra};
    if (organization.features.includes('global-views')) {
      query.project = router.location.query.project;
    }

    return {
      seriesName: 'Releases',
      data: [],
      markLine: MarkLine({
        animation: false,
        lineStyle: {
          normal: {
            color: theme.purple300,
            opacity,
            type: 'solid',
          },
        },
        tooltip: tooltip || {
          trigger: 'item',
          formatter: ({data}) => {
            // XXX using this.props here as this function does not get re-run
            // unless projects are changed. Using a closure variable would result
            // in stale values.
            const time = getFormattedDate(data.value, 'MMM D, YYYY LT', {
              local: !this.props.utc,
            });
            const version = escape(formatVersion(data.name, true));
            return [
              '<div class="tooltip-series">',
              `<div><span class="tooltip-label"><strong>${t(
                'Release'
              )}</strong></span> ${version}</div>`,
              '</div>',
              '<div class="tooltip-date">',
              time,
              '</div>',
              '</div>',
              '<div class="tooltip-arrow"></div>',
            ].join('');
          },
        },
        label: {
          show: false,
        },
        data: releases.map(release => ({
          xAxis: +new Date(release.date),
          name: formatVersion(release.version, true),
          value: formatVersion(release.version, true),
          onClick: () => {
            router.push({
              pathname: `/organizations/${organization.slug}/releases/${release.version}/`,
              query,
            });
          },
          label: {
            formatter: () => formatVersion(release.version, true),
          },
        })),
      }),
    };
  };

  render() {
    const {children} = this.props;

    return children({
      releases: this.state.releases,
      releaseSeries: this.state.releaseSeries,
    });
  }
}

export default withRouter(withOrganization(withApi(ReleaseSeries)));
