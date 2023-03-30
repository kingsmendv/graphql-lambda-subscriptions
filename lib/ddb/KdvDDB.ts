import { DynamoDB } from 'aws-sdk'
import { LoggerFunction, DDBType } from '../types'

export interface DDBClient<T extends DDBType, TKey> {
  get: (Key: TKey) => Promise<T | null>
  put: (obj: T, putOptions?: Partial<DynamoDB.DocumentClient.PutItemInput>) => Promise<T>
  update: (Key: TKey, obj: Partial<T>) => Promise<T>
  delete: (Key: TKey) => Promise<T>
  query: (options: Omit<DynamoDB.DocumentClient.QueryInput, 'TableName' | 'Select'>) => AsyncGenerator<T, void, undefined>
  custom?: { primaryKey: string }
}

export const DDB = <T extends DDBType, TKey>({
  dynamodb,
  tableName,
  log,
}: {
  dynamodb: DynamoDB
  tableName: string
  log: LoggerFunction
}): DDBClient<T, TKey> => {
  const singleTableName = 'api-service-dev'
  

  const documentClient = new DynamoDB.DocumentClient({ service: dynamodb })

  const formatKey = (Key: TKey & { id?: string }) => {
    if (Key.id) {
      return {
        PartitionKey: `${tableName}|${Key.id}`,
      } as TKey
    }
    else {
      return Key
    }
  }

  const formatItem = (Item: T) => {
    if (Item.id) {
      return {
        PartitionKey: `${tableName}|${Item.id}`,
        ...Item,
      } as T
    }
    else {
      return Item
    }
  }

  const get = async (Key: TKey): Promise<null | T> => {
    const key = formatKey(Key)
    log('get', { tableName: singleTableName, Key: key })
    try {
      const { Item } = await documentClient.get({
        TableName: singleTableName,
        Key: key,
      }).promise()
      log('get:result', { Item })
      return (Item as T) ?? null
    } catch (e) {
      log('get:error', e)
      throw e
    }
  }

  const put = async (Item: T, putOptions?: Partial<DynamoDB.DocumentClient.PutItemInput>): Promise<T> => {
    const item = formatItem(Item)
    log('put', { tableName: singleTableName, Item: item })
    try {
      const { Attributes } = await documentClient.put({
        TableName: singleTableName,
        Item: item,
        ReturnValues: 'ALL_OLD',
        ...putOptions,
      }).promise()
      return Attributes as T
    } catch (e) {
      log('put:error', e)
      throw e
    }
  }

  const update = async (Key: TKey, obj: Partial<T>) => {
    const key = formatKey(Key)
    log('update', { tableName: singleTableName, Key: key, obj })
    try {
      const AttributeUpdates = Object.entries(obj)
        .map(([key, Value]) => ({ [key]: { Value, Action: 'PUT' } }))
        .reduce((memo, val) => ({ ...memo, ...val }))

      const { Attributes } = await documentClient.update({
        TableName: singleTableName,
        Key: key,
        AttributeUpdates,
        ReturnValues: 'ALL_NEW',
      }).promise()
      return Attributes as T
    } catch (e) {
      log('update:error', e)
      throw e
    }
  }

  const deleteFunction = async (Key: TKey): Promise<T> => {
    const key = formatKey(Key)
    log('delete', { tableName: singleTableName, Key: key })
    try {
      const { Attributes } = await documentClient.delete({
        TableName: singleTableName,
        Key: key,
        ReturnValues: 'ALL_OLD',
      }).promise()
      return Attributes as T
    } catch (e) {
      log('delete:error', e)
      throw e
    }
  }

  const queryOnce = async (options: Omit<DynamoDB.DocumentClient.QueryInput, 'TableName' | 'Select'>) => {
    log('queryOnce', { tableName: singleTableName, options })
    try {
      const response = await documentClient.query({
        TableName: singleTableName,
        Select: 'ALL_ATTRIBUTES',
        ...options,
      }).promise()

      const { Items, LastEvaluatedKey, Count } = response
      return {
        items: (Items ?? []) as T[],
        lastEvaluatedKey: LastEvaluatedKey,
        count: Count ?? 0,
      }
    } catch (e) {
      log('queryOnce:error', e)
      throw e
    }
  }

  async function* query(options: Omit<DynamoDB.DocumentClient.QueryInput, 'TableName' | 'Select'>) {
    log('query', { tableName: singleTableName, options })
    try {
      const results = await queryOnce(options)
      yield* results.items
      let lastEvaluatedKey = results.lastEvaluatedKey
      while (lastEvaluatedKey) {
        const results = await queryOnce({ ...options, ExclusiveStartKey: lastEvaluatedKey })
        yield* results.items
        lastEvaluatedKey = results.lastEvaluatedKey
      }
    } catch (e) {
      log('query:error', e)
      throw e
    }
  }

  return {
    get,
    put,
    update,
    query,
    delete: deleteFunction,
    custom: {
      primaryKey: 'PartitionKey',
    },
  }
}