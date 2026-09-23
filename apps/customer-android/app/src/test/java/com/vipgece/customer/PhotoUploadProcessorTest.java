package com.vipgece.customer;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.*;
import static org.junit.Assert.*;

public final class PhotoUploadProcessorTest {
    private File root;private PendingPhotoStore store;private String id;
    private final byte[] original={1,2,3,4,5};
    @Before public void setup() throws Exception {
        root=Files.createTempDirectory("photo-processor-test-").toFile();store=new PendingPhotoStore(root);id=UUID.randomUUID().toString();
        store.stage(id,"owner-a","profile-a","image/jpeg",original);
    }
    @After public void cleanup() throws Exception {
        try(java.util.stream.Stream<Path> files=Files.walk(root.toPath())){for(Path p:files.sorted(Comparator.reverseOrder()).toArray(Path[]::new))Files.delete(p);}
    }
    @Test public void lostReplyRetriesSameBytesAndSameIdAfterProcessRecreation() throws Exception {
        AtomicInteger writes=new AtomicInteger();
        assertEquals(PhotoUploadProcessor.Outcome.RETRY,PhotoUploadProcessor.run(store,id,"owner-a",0,()->false,(entry,bytes)->{
            assertEquals(id,entry.id);assertArrayEquals(original,bytes);writes.incrementAndGet();throw new IOException("Connection lost after server commit");
        }));
        assertArrayEquals(original,store.original(id,"owner-a"));
        assertEquals(PhotoUploadProcessor.Outcome.COMPLETE,PhotoUploadProcessor.run(new PendingPhotoStore(root),id,"owner-a",1,()->false,(entry,bytes)->{
            assertEquals(id,entry.id);assertArrayEquals(original,bytes); // Server uses this ID to return the existing receipt.
        }));
        assertEquals(1,writes.get());assertFalse(new File(root,id+".job").exists());
    }
    @Test public void aDifferentOrMissingSessionNeverCallsTransport() throws Exception {
        for(String account:new String[]{"owner-b",""}){
            assertEquals(PhotoUploadProcessor.Outcome.STOP,PhotoUploadProcessor.run(store,id,account,0,()->false,(entry,bytes)->fail("Wrong account reached network")));
            assertEquals(PendingPhotoStore.State.AUTH_REQUIRED,store.load(id).state);assertArrayEquals(original,store.original(id,"owner-a"));
        }
    }
    @Test public void reauthenticatedSameOwnerCanResume() throws Exception {
        PhotoUploadProcessor.run(store,id,"",0,()->false,(entry,bytes)->fail());
        assertEquals(PhotoUploadProcessor.Outcome.COMPLETE,PhotoUploadProcessor.run(store,id,"owner-a",0,()->false,(entry,bytes)->{}));
    }
    @Test public void missingOriginalConfirmationNeverDiscardsBytes() throws Exception {
        assertEquals(PhotoUploadProcessor.Outcome.RETRY,PhotoUploadProcessor.run(store,id,"owner-a",0,()->false,(entry,bytes)->{
            throw new ApiClient.Failure(503,"ORIGINAL_NOT_CONFIRMED");
        }));
        assertArrayEquals(original,store.original(id,"owner-a"));
    }
    @Test public void retryBudgetAndPermanentErrorsRetainLocalOriginals() throws Exception {
        assertEquals(PhotoUploadProcessor.Outcome.STOP,PhotoUploadProcessor.run(store,id,"owner-a",7,()->false,(entry,bytes)->{throw new IOException();}));
        assertEquals(PendingPhotoStore.State.FAILED,store.load(id).state);assertArrayEquals(original,store.original(id,"owner-a"));
        assertEquals(PhotoUploadProcessor.Outcome.STOP,PhotoUploadProcessor.run(store,id,"owner-a",0,()->false,(entry,bytes)->{throw new ApiClient.Failure(413,"REQUEST_FAILED");}));
        assertArrayEquals(original,store.original(id,"owner-a"));
    }
    @Test public void unauthorizedReplyWaitsForOwnerLogin() throws Exception {
        assertEquals(PhotoUploadProcessor.Outcome.STOP,PhotoUploadProcessor.run(store,id,"owner-a",0,()->false,(entry,bytes)->{throw new ApiClient.Failure(401,"REQUEST_FAILED");}));
        assertEquals(PendingPhotoStore.State.AUTH_REQUIRED,store.load(id).state);
    }
    @Test public void stoppedOrCancelledWorkCannotSend() throws Exception {
        assertEquals(PhotoUploadProcessor.Outcome.STOP,PhotoUploadProcessor.run(store,id,"owner-a",0,()->true,(entry,bytes)->fail()));
        store.state(id,"owner-a",PendingPhotoStore.State.CANCELLED,"");
        assertEquals(PhotoUploadProcessor.Outcome.STOP,PhotoUploadProcessor.run(store,id,"owner-a",0,()->false,(entry,bytes)->fail()));
    }
    @Test public void cancellationWhileSendingCannotBeReopenedByLateReply() throws Exception {
        assertEquals(PhotoUploadProcessor.Outcome.STOP,PhotoUploadProcessor.run(store,id,"owner-a",0,()->false,(entry,bytes)->{
            store.state(id,"owner-a",PendingPhotoStore.State.CANCELLED,"");
        }));
        assertEquals(PendingPhotoStore.State.CANCELLED,store.load(id).state);
        assertFalse(new File(root,id+".job").exists());
    }
}
