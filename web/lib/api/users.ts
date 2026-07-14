export interface ApiUser {
  id: string;
  wx_openid?: string | null;
  nickname?: string | null;
  is_minor?: boolean | null;
  guardian_consent?: boolean | null;
}

export type UsersClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: ApiUser | null }>;
      };
    };
  };
};

export type EnsureUserClient = {
  from(table: string): {
    upsert(row: Record<string, unknown>, options: { onConflict: string }): {
      select(columns: string): {
        maybeSingle(): PromiseLike<{ data: Pick<ApiUser, 'id' | 'wx_openid'> | null; error: { message?: string } | null }>;
      };
    };
  };
};

export async function findUserByOpenid(client: UsersClient, openid: string): Promise<ApiUser | null> {
  const { data } = await client
    .from('users')
    .select('id,wx_openid,nickname,is_minor,guardian_consent')
    .eq('wx_openid', openid)
    .maybeSingle();
  return data;
}

export async function ensureUserByOpenid(client: EnsureUserClient, openid: string): Promise<Pick<ApiUser, 'id' | 'wx_openid'> | null> {
  const { data, error } = await client
    .from('users')
    .upsert(
      {
        wx_openid: openid,
        last_active_at: new Date().toISOString(),
      },
      { onConflict: 'wx_openid' },
    )
    .select('id,wx_openid')
    .maybeSingle();
  if (error) throw new Error(error.message ?? 'ensure user failed');
  return data;
}
