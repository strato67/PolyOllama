// WebSocketContext.tsx
import React, { createContext, useContext, useEffect, useState, ReactNode, FC, useCallback, useRef, MutableRefObject } from 'react';
import { useOllamaClientsStore } from './stores/use-ollama-clients-store';
import { useChatEntriesStore } from './stores/use-chat-entries';

enum MessageType {
    RegisterEndpoints = 'register-endpoints',
    ChatMessage = 'on-chat-message',
    ChatTitleCreated = 'on-chat-title-created',
}


// Union type for the Message
type Message = {
    type: MessageType;
    endpoint: string | null;
    data: any;
};

type WebSocketContextType = {
    socket: MutableRefObject<WebSocket | null>;
    isConnected: boolean;
    sendMessage: (message: any) => void;
    registerHandler: (endpoint: string, handler: (message: Message) => void) => void;
    unregisterHandler: (endpoint: string) => void;
    registerChatTitleCreatedHandler: (handlerId: `${string}-${number}`, handler: (message: Message) => void) => void;
    unregisterChatTitleCreatedHandler: (handlerId: `${string}-${number}`) => void;
};

export const websocketReadyStateToString = (readyState: number) => {
    switch (readyState) {
        case WebSocket.CONNECTING:
            return 'CONNECTING';
        case WebSocket.OPEN:
            return 'OPEN';
        case WebSocket.CLOSING:
            return 'CLOSING';
        case WebSocket.CLOSED:
            return 'CLOSED';
        default:
            return 'UNKNOWN';
    }
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = (): WebSocketContextType => {
    const context = useContext(WebSocketContext);
    if (!context) throw new Error('useWebSocket must be used within a WebSocketProvider');
    return context;
};

type WebSocketProviderProps = {
    children: ReactNode;
    host?: string;
    port?: number;
};

export const WebSocketProvider: FC<WebSocketProviderProps> = ({ children, host = 'example.com', port }) => {

    // const [messageHandlers, setMessageHandlers] = useState<Map<string, (message: Message) => void>>(new Map());
    const newMessageHandlers = useRef<Map<string, (message: Message) => void>>(new Map());
    const chatTitleCreatedHandlers = useRef<Map<`${string}-${number}`, (message: Message) => void>>(new Map());

    // const [socket, setSocket] = useState<WebSocket | null>(null);
    const socket = useRef<WebSocket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const { setEndpoints, clearEndpoints, addAvailableEndpoints } = useOllamaClientsStore((state) => state);
    const { createChatEntriesByEndpoint } = useChatEntriesStore((state) => state);

    useEffect(() => {
        // console.log(`useffect socket: ${socket}`);
        // console.log(`WebSocket readyState: ${websocketReadyStateToString(socket?.current?.readyState ?? -1)}`);
    }, [socket]);

    // useEffect(() => {
    //     if (socket?.readyState === WebSocket.OPEN) {
    //         setIsConnected(true);
    //     } else {
    //         setIsConnected(false);
    //     }
    // }, [socket?.readyState]);

    useEffect(() => {
        const url = `ws://${host}${port ? `:${port}` : ''}`;
        const newSocket = new WebSocket(url);

        socket.current = newSocket;

        newSocket.onopen = (event) => {
            // console.log('WebSocket is connected.', event);
            // console.log(`WebSocket readyState: ${websocketReadyStateToString(newSocket.readyState)}`);
            setIsConnected(true);
        };
        newSocket.onclose = () => {
            // console.log('WebSocket is closed.');
            // for (const endpoint of messageHandlers.keys()) {
            //     unregisterHandler(endpoint);
            // }
            clearEndpoints();
            setIsConnected(false);
        }
        newSocket.onerror = (error: Event) => {
            console.error('WebSocket Error:', error);
            setIsConnected(false);
        };

        newSocket.onmessage = (event: MessageEvent) => {
            // Handle incoming messages
            const message: Message = JSON.parse(event.data);
            // // console.log('WebSocket message received:', message);

            if (message.type === MessageType.ChatTitleCreated) {
                // console.log('abc Chat title created:', message);
                // handlerId for chatTitleCreatedHandlers is the `a unique string`-`chatId number`
                // ex. "sidebar_chatTitleCreatedHandler-1", "chat_windows_chatTitleCreatedHandler-2"
                // we need to call the handler for each handlerId that matches the chatId
                const dataCasted = message.data as { chatId: number, title: string };
                if (dataCasted.chatId === null || dataCasted.chatId === undefined || isNaN(dataCasted.chatId)) {
                    console.warn('abc ChatId is null. Chat title not handled.');
                    return;
                }
                if (dataCasted.title === null || dataCasted.title === undefined || dataCasted.title === '') {
                    console.warn('abc Chat title is null or empty. Chat title not handled.');
                    return;
                }
                for (const [handlerId, handler] of chatTitleCreatedHandlers.current.entries()) {
                    const [_, chatIdStr] = handlerId.split('-');
                    const chatId = parseInt(chatIdStr);
                    if (dataCasted.chatId === chatId) {
                        // console.log(`abc Calling chatTitleCreatedHandler for chatId: ${chatId}`);
                        handler(message);
                    }
                }
            }


            if (message.type === MessageType.RegisterEndpoints) {
                const { endpoints } = message.data;
                // console.log('Registering endpoints:', endpoints)
                setEndpoints(endpoints);
                for (const endpoint of endpoints) {
                    createChatEntriesByEndpoint(endpoint);
                }
            }

            if (message.type === MessageType.ChatMessage) {
                // // console.log('Handling chat message:', message);
                if (message.endpoint === null) {
                    console.warn('Message endpoint is null. Message not handled.');
                    return;
                }

                const handler = newMessageHandlers.current.get(message.endpoint);
                if (!handler) {
                    console.warn(`No handler registered for endpoint: ${message.endpoint}. Message not handled.`);
                    return;
                }

                handler(message);

            }

        };



        return () => {
            // console.log(`WebSocket is closing. (readyState: ${websocketReadyStateToString(newSocket.readyState)})`);
            if (newSocket.readyState === WebSocket.OPEN) {
                newSocket.close();
            }
        };
    }, [host, port]);

    const sendMessage = (message: any) => {
        // console.log(`Sending message, socket: ${socket.current}`);
        // console.log(`Sending message, WebSocket readyState: ${websocketReadyStateToString(socket?.current?.readyState ?? -1)}`);

        // console.log(`Sending message:`);
        // console.log(message);

        if (socket?.current && socket?.current?.readyState === WebSocket.OPEN) {

            function replacer(key: string, value: any): any {
                if (value instanceof Uint8Array) {
                    return { type: 'Uint8Array', data: Array.from(value) };
                }
                return value;
            }

            // console.log(`Sending message:`);
            // console.log(message);
            const stringifiedMessage = JSON.stringify(message, replacer);
            // console.log(`Sending message: ${stringifiedMessage}`);

            // console.log(`afg ${websocketReadyStateToString(socket?.current?.readyState ?? -1)}`);
            socket.current.send(stringifiedMessage);
        } else {
            console.warn('WebSocket is not connected. Message not sent.');
        }
    };

    const registerHandler = useCallback((endpoint: string, handler: (message: Message) => void) => {
        // console.log(`Registering handler for endpoint: ${endpoint}`);
        newMessageHandlers.current.set(endpoint, handler);
    }, []);

    const unregisterHandler = useCallback((endpoint: string) => {
        // console.log(`Unregistering handler for endpoint: ${endpoint}`);
        newMessageHandlers.current.delete(endpoint);
    }, []);


    const registerChatTitleCreatedHandler = useCallback((handlerId: `${string}-${number}`, handler: (message: Message) => void) => {
        // console.log('abc Registering chatTitleCreatedHandler:', handlerId, handler)
        chatTitleCreatedHandlers.current.set(handlerId, handler);
    }, []);

    const unregisterChatTitleCreatedHandler = useCallback((handlerId: `${string}-${number}`) => {
        // console.log('abc Unregistering chatTitleCreatedHandler:', handlerId);
        chatTitleCreatedHandlers.current.delete(handlerId);
    }, []);

    return (
        <WebSocketContext.Provider value={{ socket: socket, isConnected, sendMessage, registerHandler, unregisterHandler, registerChatTitleCreatedHandler, unregisterChatTitleCreatedHandler }}>
            {/* {socket?.current?.readyState === WebSocket.OPEN ? <p>Connected to WebSocket</p> : <p>Disconnected from WebSocket</p>}
            {children} */}
            {children}
        </WebSocketContext.Provider>
    );
};
