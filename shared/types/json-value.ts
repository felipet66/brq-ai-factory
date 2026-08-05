export type JsonPrimitive = boolean | number | string | null;

export type JsonObject = {
  [key: string]: JsonValue;
};

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
