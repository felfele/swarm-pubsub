import { SwarmClient, createHex } from '@erebos/swarm'
import { createKeyPair, sign } from '@erebos/secp256k1'
import { toHexValue } from '@erebos/hex'
import { pubKeyToAddress } from '@erebos/keccak256'
import * as crypto from 'crypto'

const gateway = 'http://localhost:8500'

const stripHexPrefix = (s: string) => s.startsWith("0x") ? s.slice(2) : s
const waitMillisec = (ms: number): Promise<void> => {
    return new Promise<void>((resolve) => {
        if (ms > 0) {
            setTimeout(() => resolve(), ms)
        }
    })
}

interface Location {
    keyPair: KeyPair
    previous?: string
}

interface Update {
    publicKey: string
    data: string
}

interface UpdateWithHash extends Update {
    hash: string
}

interface KeyPair {
    publicKey: string
    privateKey: string
    address: string
}

let running = true

const generateKeyPair = (privKey?: string): KeyPair => {
    const keyPair = createKeyPair(stripHexPrefix(privKey))
    const privateKey = '0x' + keyPair.getPrivate("hex")
    const publicKey = '0x' + keyPair.getPublic("hex")
    const address = pubKeyToAddress(createHex(publicKey).toBuffer())
    return {
        publicKey,
        privateKey,
        address,
    }
}

const waitForHash = async (swarm: SwarmClient, user: string): Promise<string> => {
    while (true) {
        try {
            const response = await swarm.bzz.getRawFeedContentHash({
                user,
                time: 0,
                level: 0,
            })
            return response
        } catch (e) {
            await waitMillisec(1000)
        }
    }
}

const waitForUpdate = async (swarm: SwarmClient, user: string): Promise<UpdateWithHash | undefined> => {
    try {
        const hash = await waitForHash(swarm, user)
        const response = await swarm.bzz.download(hash, {mode: 'raw'})
        const json = await response.json()
        const update = parseUpdate(json)
        return {
            ...update,
            hash,
        }
    } catch (e) {
        return undefined
    }
}

const isValidUpdate = (update: Update): boolean => {
    return true
}

const parseUpdate = (json: string): Update | undefined => {
    try {
        const update = JSON.parse(json)
        return isValidUpdate(update)
            ? update
            : undefined
    } catch (e) {
        return undefined
    }
}

const server = async () => {
    const privateKey = "0xae402705d028aac6c62ea98a54b5ae763f527c3e14cf84c89a1e4e4ec4d43921"
    const publicKey = "0x035823ce10d0e06bfc14ff26f50776916fc920c9ce75b5ab8c96e3f395f13d179f"
    const address = "0xa1615832e7196080d058698a8d85b00bbc2a19dd"

    const signBytes = async bytes => sign(bytes, stripHexPrefix(privateKey))

    const swarm = new SwarmClient({bzz: {url: gateway, signBytes: signBytes}})

    let previous = undefined
    while (running) {
        const sharedKeyPair = generateKeyPair()
        const random = toHexValue(crypto.randomBytes(32))
        const location: Location = {
            keyPair: sharedKeyPair,
            previous,
        }
        const locationJson = JSON.stringify(location)
        const contentHash = await swarm.bzz.setFeedContent({
                user: address,
            },
            locationJson
        )
        console.log({contentHash})

        const updateWithHash = await waitForUpdate(swarm, sharedKeyPair.address)
        if (updateWithHash == null) {
            continue
        }
        console.log({updateWithHash})

        previous = updateWithHash.hash
    }
}

const client = async (serverAddress: string) => {
    const clientKeyPair = generateKeyPair()
    console.log('privateKey', {clientKeyPair})
    const swarmClient = new SwarmClient({bzz: {url: gateway}})

    while (true) {
        try {
            const response = await swarmClient.bzz.getFeedContent({
                user: serverAddress,
            }, {
                mode: 'raw'
            })
            const location = await response.json() as Location
            console.log({location})
            const randomValue = toHexValue(crypto.randomBytes(32))
            const update: Update = {
                publicKey: clientKeyPair.publicKey,
                data: randomValue,
            }
            const updateJson = JSON.stringify(update)
            const signBytes = async bytes => sign(bytes, stripHexPrefix(location.keyPair.privateKey))
            const swarm = new SwarmClient({bzz: {url: gateway, signBytes: signBytes}})

            await swarm.bzz.setRawFeedContent({
                user: location.keyPair.address,
            }, updateJson)

            break

        } catch (e) {
            console.log({e})
            await waitMillisec(1000)
        }
    }
}

if (process.argv[2] === 'server') {
    server()
} else {
    client(process.argv[3])
}
