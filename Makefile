all: llamacpp llamaswap

.PHONY: jev-test jev-typecheck
jev-test:
	bun test ./jev/test/*.test.ts

jev-typecheck:
	localjev/node_modules/.bin/tsc -p jev/tsconfig.json

llamacpp:
	cd llama.cpp && CC=/usr/bin/gcc-14 CXX=/usr/bin/g++-14 cmake -B build -DGGML_CUDA=ON -DCMAKE_CUDA_HOST_COMPILER=/usr/bin/g++-14
	cd llama.cpp && cmake --build build --config Release

llamaswap:
	cd llama-swap && make clean
	cd llama-swap && make all
