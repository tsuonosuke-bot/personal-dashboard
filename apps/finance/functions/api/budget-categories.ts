import {
  fetchSupabasePage,
  methodNotAllowed,
  readPagination,
  type SupabaseEnv,
} from '../_shared/supabaseRest.ts'

type FunctionContext = {
  request: Request
  env: SupabaseEnv
}

const SELECT_COLUMNS = 'id,name,notion_url'

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== 'GET') return methodNotAllowed()
  const pagination = readPagination(context.request)
  if (pagination instanceof Response) return pagination
  return fetchSupabasePage(context.env, {
    table: 'budget_categories',
    params: new URLSearchParams({
      select: SELECT_COLUMNS,
      order: 'id.asc',
    }),
  }, pagination)
}
