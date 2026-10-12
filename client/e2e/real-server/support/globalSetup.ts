import { compileServer, startRealServer } from './realServer'

export const SUB_DIRECTORY = '/synthetic-epgstation'

/**
 * 本物の v3 server を 2 つ起動し、その URL を test へ渡す。1 つは root で配り、もう 1 つは `subDirectory` を設定して
 * その path の下で配る。戻り値の関数が teardown で server を止める。
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const compiled = await compileServer()
  const cleanups: Array<() => Promise<void>> = [() => compiled.remove()]
  const teardown = async (): Promise<void> => {
    for (const cleanup of cleanups.reverse()) await cleanup()
  }
  try {
    const root = await startRealServer(compiled)
    cleanups.push(() => root.stop())
    const subDirectory = await startRealServer(compiled, { subDirectory: SUB_DIRECTORY })
    cleanups.push(() => subDirectory.stop())
    process.env.EPGSTATION_REAL_SERVER_ORIGIN = root.origin
    process.env.EPGSTATION_REAL_SERVER_SUBDIRECTORY_URL = `${subDirectory.origin}${SUB_DIRECTORY}`
  } catch (error) {
    await teardown()
    throw error
  }
  return teardown
}
