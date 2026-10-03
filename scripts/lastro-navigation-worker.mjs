const nativeQueue = `	var t = class {
		constructor() {
			this.values = [];
		}
		enqueue(t, e) {
			this.values.push({
				val: t,
				priority: e
			}), this.sort();
		}
		dequeue() {
			return this.values.shift();
		}
		sort() {
			this.values.sort((t, e) => t.priority - e.priority);
		}
	};`;

const heapQueue = `	var t = class {
		constructor() {
			this.values = [];
			this.open = new Set();
			this.sequence = 0;
		}
		before(a, b) {
			// Native stable sorting preserves insertion order at equal priorities.
			return (a.priority - b.priority || a.sequence - b.sequence) < 0;
		}
		enqueue(value, priority) {
			const values = this.values;
			values.push({ val: value, priority, sequence: this.sequence++ });
			this.open.add(e(value[0], value[1]));
			let index = values.length - 1;
			while (index > 0) {
				const parent = (index - 1) >> 1;
				if (!this.before(values[index], values[parent])) break;
				[values[index], values[parent]] = [values[parent], values[index]];
				index = parent;
			}
		}
		dequeue() {
			const values = this.values;
			if (!values.length) return undefined;
			const first = values[0], last = values.pop();
			this.open.delete(e(first.val[0], first.val[1]));
			if (values.length) {
				values[0] = last;
				let index = 0;
				while (true) {
					const left = index * 2 + 1;
					if (left >= values.length) break;
					const right = left + 1;
					let next = left;
					if (right < values.length && this.before(values[right], values[left])) next = right;
					if (!this.before(values[next], values[index])) break;
					[values[index], values[next]] = [values[next], values[index]];
					index = next;
				}
			}
			return first;
		}
		has(key) {
			return this.open.has(key);
		}
	};`;

function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error('anchor:navigation-worker');
  return source.replace(anchor, replacement);
}

export function patchNavigationWorker(source) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const normalized = source.replace(/\r\n/g, '\n');
  if (newline === '\r\n' && normalized.replaceAll('\n', '\r\n') !== source) {
    throw new Error('anchor:navigation-worker-newline');
  }
  // Only replace the queue and its membership lookup; keep all path decisions native.
  let output = replaceOnce(normalized, nativeQueue, heapQueue);
  output = replaceOnce(output, 'f.values.some((s) => e(s.val[0], s.val[1]) === t)', 'f.has(t)');
  return newline === '\n' ? output : output.replaceAll('\n', '\r\n');
}
