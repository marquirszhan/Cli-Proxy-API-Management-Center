/**
 * 版本相关 API
 *
 * 主程序检查更新走实际运行的 caidaoli 仓库 Release，
 * 不走后端 /latest-version（那条接口查的是官方 router-for-me，版本线对不上）。
 */

import { MAIN_PROGRAM_LATEST_RELEASE_API } from '@/utils/projectRepos';

export interface LatestVersionResult {
  'latest-version': string;
  latest_version: string;
  html_url?: string;
}

const readGitHubTag = (payload: unknown): { tag: string; htmlUrl?: string } => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('invalid GitHub release payload');
  }
  const record = payload as Record<string, unknown>;
  const tag = typeof record.tag_name === 'string' ? record.tag_name.trim() : '';
  if (!tag) {
    throw new Error('empty GitHub release tag');
  }
  return {
    tag,
    htmlUrl: typeof record.html_url === 'string' ? record.html_url : undefined,
  };
};

export const versionApi = {
  checkLatest: async (): Promise<LatestVersionResult> => {
    const response = await fetch(MAIN_PROGRAM_LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
      throw new Error(`GitHub ${response.status}`);
    }
    const { tag, htmlUrl } = readGitHubTag(await response.json());
    return {
      'latest-version': tag,
      latest_version: tag,
      html_url: htmlUrl,
    };
  },
};
