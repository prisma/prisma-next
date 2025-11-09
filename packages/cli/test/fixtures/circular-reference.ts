const contract: Record<string, unknown> = {
  foo: 'bar',
};

contract.self = contract;

export const contract = contract;
